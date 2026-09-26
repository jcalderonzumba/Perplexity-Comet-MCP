// The ask core: `comet_ask` once, for every adapter alike, over a small port
// each adapter satisfies with its CDP client and Comet module.
//
// An ask validates its arguments before anything reaches the browser,
// shapes the prompt, brings the connection to a Perplexity tab, puts back
// the mode `comet_mode` last set, sends the prompt (typed and submitted
// with trusted input by `ask-send.ts`), and waits for an answer
// that is new: one that differs from the response on the page before the
// prompt was sent. When its time runs out it says so and keeps the task
// active, so the answer is never presented as complete before it is. The
// outcome is data; `describeAskOutcome` words it, and the adapter wraps the
// page text in it.
//
// `comet_poll` and `comet_stop` follow the same task. A poll of a task the
// ask left running applies the ask's completion rules, against the page as
// it was before the prompt was sent, so it returns the answer only once it
// is complete and new, and otherwise says the task is still working.

import type { ProseState } from "../page-scripts.js";
import {
  type AskRequest,
  readAskRequest,
  shapePrompt,
  withContext,
} from "./ask-input.js";
import { type ModeNotice, reapplyModeBeforeAsk } from "./ask-mode.js";
import { PromptNotSent, type PromptPort, sendPrompt } from "./ask-send.js";
import { AskTaskState } from "./ask-task.js";
import type { ModeTool } from "./mode-tool.js";
import { PageScriptFailed } from "./page-script-failed.js";

export { PageScriptFailed };

export const PERPLEXITY_HOME = "https://www.perplexity.ai/";

/** A browser target, as the CDP client lists it. */
export interface AskTarget {
  readonly id: string;
  readonly type: string;
  readonly url: string;
}

/** What the page shows about the answer, as the Comet module reads it. */
export interface AskStatus {
  readonly status: "idle" | "working" | "completed";
  readonly steps: readonly string[];
  readonly currentStep: string;
  readonly response: string;
  readonly hasStopButton: boolean;
  /** The response has not changed over the last few reads. */
  readonly isStable: boolean;
  /** The address of the tab the agent is browsing, or empty. */
  readonly agentBrowsingUrl: string;
}

/**
 * What the ask core needs from the browser, the send step's needs among
 * them; each adapter supplies one. A read through a page script rejects
 * with `PageScriptFailed` when the script throws in the page.
 */
export interface AskPort extends PromptPort {
  /** Checks the connection is alive; throws when it is not. */
  preOperationCheck(): Promise<unknown>;
  /** Starts Comet with its debug port on `port`, or finds it running. */
  startComet(port: number): Promise<unknown>;
  listTargets(): Promise<readonly AskTarget[]>;
  connect(targetId: string): Promise<unknown>;
  ensureConnection(): Promise<unknown>;
  navigate(url: string, waitForLoad: boolean): Promise<unknown>;
  /** The main Perplexity tab, not the sidecar, when one is open. */
  mainTab(): Promise<AskTarget | null>;
  /** The address of the connected tab. */
  currentUrl(): Promise<string>;
  isOnPerplexityTab(): Promise<boolean>;
  /** Moves the connection back to a Perplexity tab; false when it cannot. */
  ensureOnPerplexityTab(): Promise<boolean>;
  readStatus(): Promise<AskStatus>;
  /** Forgets the responses seen, before a new prompt is sent. */
  resetStabilityTracking(): void;
  /** Stops the answer in progress; false when there was nothing to stop. */
  stopAgent(): Promise<boolean>;
}

/** The ask's waits, in milliseconds. */
export const ASK_TIMING = {
  /** Between two reads of the page while waiting for the answer. */
  pollMs: 1500,
  /** A long answer unchanged for this long is complete. */
  idleMs: 6000,
  /** After opening Perplexity's home page for a new chat. */
  newChatSettleMs: 2000,
  /** After falling back to another tab when that navigation failed. */
  fallbackSettleMs: 1500,
  /** After moving a follow-up's tab to Perplexity. */
  homeSettleMs: 2000,
} as const;

/** Failed reads in a row after which the connection itself is re-checked. */
const MAX_CONSECUTIVE_ERRORS = 5;

/** The idle rule's answers are longer than this. */
const IDLE_ANSWER_MIN_LENGTH = 100;

const CONNECTION_FAILED = "Failed to establish connection to Comet browser";

const NO_NOTICE: ModeNotice = { line: null };

/** What the page showed when the ask's time ran out; all of it page text. */
export interface AskProgress {
  readonly status: AskStatus["status"] | "unknown";
  /** The new response so far, or empty when there is none. */
  readonly partialAnswer: string;
  readonly currentStep: string;
  readonly steps: readonly string[];
}

export type AskOutcome =
  | { readonly kind: "refused"; readonly reason: string }
  | {
      readonly kind: "failed";
      readonly message: string;
      /** The page's part of the failure, when a page script threw. */
      readonly pageDetail?: string;
      readonly notice: ModeNotice;
    }
  | {
      readonly kind: "answered";
      readonly answer: string;
      readonly notice: ModeNotice;
    }
  | {
      readonly kind: "timed-out";
      readonly timeoutMs: number;
      readonly progress: AskProgress;
      readonly notice: ModeNotice;
    };

/** What a poll read on the page, for a task that has no answer yet. */
export interface PollProgress extends AskProgress {
  /** The address of the tab the agent is browsing, or empty. */
  readonly browsingUrl: string;
}

export type PollOutcome =
  | { readonly kind: "no-task" }
  /** The last task finished too long ago to follow. */
  | { readonly kind: "expired" }
  /** The task completed before this poll, `secondsAgo` seconds ago. */
  | {
      readonly kind: "completed";
      readonly answer: string;
      readonly secondsAgo: number;
    }
  /** This poll found the answer complete, and ended the task. */
  | { readonly kind: "answered"; readonly answer: string }
  /** The task is followed and its answer is not complete yet. */
  | {
      readonly kind: "working";
      readonly taskId: string | null;
      readonly progress: PollProgress;
    }
  /**
   * The task has no answer and is no longer followed: it was stopped, or its
   * prompt was never sent. The page's status is reported, never its text as
   * the answer.
   */
  | {
      readonly kind: "not-followed";
      readonly taskId: string | null;
      readonly progress: PollProgress;
    }
  /**
   * A page script threw while this poll read the page for a task it
   * follows. The task stays active; `pageDetail` is the page's text.
   */
  | {
      readonly kind: "page-error";
      readonly taskId: string | null;
      readonly message: string;
      readonly pageDetail: string;
    };

export interface StopOutcome {
  /** False when the page showed nothing to stop. */
  readonly stopped: boolean;
}

export interface AskCoreOptions {
  readonly port: AskPort;
  /** The mode tool whose remembered mode the ask puts back. */
  readonly mode: Pick<ModeTool, "core" | "quotePage">;
  /** The debug port Comet is started on when the connection is lost. */
  readonly cometPort: number;
}

/** What was on the page before the prompt was sent. */
interface PageBefore {
  readonly prose: ProseState;
  readonly response: string;
}

/**
 * Asks Comet and waits for the answer. Each adapter creates one when it
 * starts, so the task it follows lives as long as the server and belongs
 * to it alone.
 */
export class AskCore {
  readonly task: AskTaskState;
  private readonly port: AskPort;
  /** The completion rules of the task's answer, once its prompt is sent. */
  private watch: AnswerWatch | null = null;

  constructor(private readonly options: AskCoreOptions) {
    this.port = options.port;
    this.task = new AskTaskState(() => options.port.now());
  }

  async ask(args: Record<string, unknown> | undefined): Promise<AskOutcome> {
    const reading = readAskRequest(args);
    if (!reading.ok) return { kind: "refused", reason: reading.reason };
    const { request } = reading;
    const prompt = withContext(request.prompt, request.context);
    this.task.start(prompt);
    this.watch = null;
    const outcome = await this.connectSendAndWait(request, prompt);
    if (outcome.kind === "failed" && this.watch === null) this.task.abandon();
    return outcome;
  }

  /** The ask once its task has started, any failure as an outcome. */
  private async connectSendAndWait(
    request: AskRequest,
    prompt: string,
  ): Promise<AskOutcome> {
    let notice = NO_NOTICE;
    try {
      if (!(await this.connectOrRecover())) {
        return { kind: "failed", message: CONNECTION_FAILED, notice };
      }
      await (request.newChat ? this.openNewChat() : this.stayOnPerplexity());
      notice = await reapplyModeBeforeAsk(this.options.mode);
      return await this.sendAndWait(
        shapePrompt(prompt),
        request.timeoutMs,
        notice,
      );
    } catch (error) {
      return failure(error, notice);
    }
  }

  /**
   * The task's state: its answer once complete, or what the page shows of
   * it. The page is read only for a task that has no answer yet.
   */
  async poll(): Promise<PollOutcome> {
    const { task } = this;
    if (!task.isActive && task.currentTaskId === null) {
      return { kind: "no-task" };
    }
    if (!task.isActive && task.isStale()) return { kind: "expired" };
    if (!task.isActive && task.lastResponse !== null) {
      return {
        kind: "completed",
        answer: task.lastResponse,
        secondsAgo: this.secondsSince(task.lastResponseTime),
      };
    }
    await this.port.ensureOnPerplexityTab();
    if (task.isActive && this.watch) return this.followOrReport(this.watch);
    return this.pageStatusOnly();
  }

  /** `follow`, with a page script's failure reported as an outcome. */
  private async followOrReport(watch: AnswerWatch): Promise<PollOutcome> {
    try {
      return await this.follow(watch);
    } catch (error) {
      if (!(error instanceof PageScriptFailed)) throw error;
      const { message, pageDetail } = error;
      const taskId = this.task.currentTaskId;
      return { kind: "page-error", taskId, message, pageDetail };
    }
  }

  /** Stops the answer in progress; the task ends when something stopped. */
  async stop(): Promise<StopOutcome> {
    const stopped = await this.port.stopAgent();
    if (stopped) this.task.isActive = false;
    return { stopped };
  }

  /** One read of the page, judged by the ask's completion rules. */
  private async follow(watch: AnswerWatch): Promise<PollOutcome> {
    const prose = await this.port.readProseState();
    const status = await this.port.readStatus();
    const now = this.port.now();
    watch.observe(prose, status, now);
    this.task.steps = [...watch.steps];
    if (watch.isComplete(status, now)) {
      this.task.complete(status.response);
      return { kind: "answered", answer: status.response };
    }
    return {
      kind: "working",
      taskId: this.task.currentTaskId,
      progress: {
        ...pollProgress(status, this.task.steps),
        partialAnswer: watch.newResponse(status.response),
      },
    };
  }

  private async pageStatusOnly(): Promise<PollOutcome> {
    const status = await this.port.readStatus();
    return {
      kind: "not-followed",
      taskId: this.task.currentTaskId,
      progress: pollProgress(status, this.task.steps),
    };
  }

  private secondsSince(then: number | null): number {
    return then === null ? 0 : Math.round((this.port.now() - then) / 1000);
  }

  /** True when connected, after starting Comet again if the check failed. */
  private async connectOrRecover(): Promise<boolean> {
    try {
      await this.port.preOperationCheck();
      return true;
    } catch {
      // The connection is gone: start Comet, or find it, and reconnect.
    }
    try {
      await this.port.startComet(this.options.cometPort);
      const page = recoveryPage(await this.port.listTargets());
      if (page) await this.port.connect(page.id);
      return true;
    } catch {
      return false;
    }
  }

  private async openNewChat(): Promise<void> {
    await this.port.ensureConnection();
    try {
      await this.port.navigate(PERPLEXITY_HOME, true);
      await this.port.wait(ASK_TIMING.newChatSettleMs);
    } catch {
      await this.fallBackToAnotherTab();
    }
  }

  /** After a failed navigation: a Perplexity tab, or any page sent there. */
  private async fallBackToAnotherTab(): Promise<void> {
    const pages = (await this.port.listTargets()).filter(isPage);
    const perplexityTab = pages.find((page) => page.url.includes("perplexity"));
    if (perplexityTab) {
      await this.port.connect(perplexityTab.id);
    } else if (pages[0]) {
      await this.port.connect(pages[0].id);
      await this.port.navigate(PERPLEXITY_HOME, true);
    }
    await this.port.wait(ASK_TIMING.fallbackSettleMs);
  }

  /** A follow-up asks in the main Perplexity tab, or sends the tab there. */
  private async stayOnPerplexity(): Promise<void> {
    const main = await this.port.mainTab();
    if (main) await this.port.connect(main.id);
    const url = await this.port.currentUrl();
    if (url?.includes("perplexity.ai")) return;
    await this.port.navigate(PERPLEXITY_HOME, true);
    await this.port.wait(ASK_TIMING.homeSettleMs);
  }

  private async sendAndWait(
    prompt: string,
    timeoutMs: number,
    notice: ModeNotice,
  ): Promise<AskOutcome> {
    this.port.resetStabilityTracking();
    const before = await this.readPageBefore();
    await sendPrompt(this.port, prompt, before.prose);
    this.watch = new AnswerWatch(before, this.port.now());
    return this.waitForAnswer(this.watch, timeoutMs, notice);
  }

  private async readPageBefore(): Promise<PageBefore> {
    const prose = await this.port.readProseState();
    try {
      return { prose, response: (await this.port.readStatus()).response };
    } catch {
      // Without it, freshness still requires a non-empty response.
      return { prose, response: "" };
    }
  }

  private async waitForAnswer(
    watch: AnswerWatch,
    timeoutMs: number,
    notice: ModeNotice,
  ): Promise<AskOutcome> {
    const startedAt = this.port.now();
    let errors = 0;
    while (this.port.now() - startedAt < timeoutMs) {
      await this.port.wait(ASK_TIMING.pollMs);
      try {
        if (!(await this.onPerplexity())) {
          errors++;
          continue;
        }
        const prose = await this.port.readProseState();
        const status = await this.port.readStatus();
        errors = 0;
        watch.observe(prose, status, this.port.now());
        this.task.steps = [...watch.steps];
        if (watch.isComplete(status, this.port.now())) {
          this.task.complete(status.response);
          return { kind: "answered", answer: status.response, notice };
        }
      } catch {
        const remaining = await this.recoverFromFailedRead(errors + 1);
        if (remaining === undefined) break;
        errors = remaining;
      }
    }
    return {
      kind: "timed-out",
      timeoutMs,
      progress: await this.progressSoFar(watch),
      notice,
    };
  }

  private async onPerplexity(): Promise<boolean> {
    return (
      (await this.port.isOnPerplexityTab()) ||
      (await this.port.ensureOnPerplexityTab())
    );
  }

  /**
   * After a failed read: the errors in a row that remain once the tab is
   * back on Perplexity, or undefined when the connection cannot be kept.
   */
  private async recoverFromFailedRead(
    errors: number,
  ): Promise<number | undefined> {
    try {
      if (await this.port.ensureOnPerplexityTab()) return errors - 1;
    } catch {
      // Fall through to the connection check.
    }
    if (errors < MAX_CONSECUTIVE_ERRORS) return errors;
    try {
      await this.port.ensureConnection();
      await this.port.ensureOnPerplexityTab();
      return 0;
    } catch {
      return undefined;
    }
  }

  /** What the page shows now, for a result that is not the answer. */
  private async progressSoFar(watch: AnswerWatch): Promise<AskProgress> {
    try {
      const status = await this.port.readStatus();
      return {
        status: status.status,
        partialAnswer: watch.newResponse(status.response),
        currentStep: status.currentStep,
        steps: [...watch.steps],
      };
    } catch {
      return {
        status: "unknown",
        partialAnswer: "",
        currentStep: "",
        steps: [...watch.steps],
      };
    }
  }
}

/**
 * The completion rules, over the reads of one wait. Each requires a new
 * response: the page has shown a new prose block or text since the prompt
 * was sent, and the response differs from the one on the page before.
 */
class AnswerWatch {
  readonly steps: string[] = [];
  private sawNewResponse = false;
  private lastResponse = "";
  private lastActivityAt: number;

  constructor(
    private readonly before: PageBefore,
    startedAt: number,
  ) {
    this.lastActivityAt = startedAt;
  }

  observe(prose: ProseState, status: AskStatus, now: number): void {
    if (this.showsNewProse(prose)) this.sawNewResponse = true;
    if (status.response !== this.lastResponse) {
      this.lastResponse = status.response;
      this.lastActivityAt = now;
    }
    for (const step of status.steps) {
      if (this.steps.includes(step)) continue;
      this.steps.push(step);
      this.lastActivityAt = now;
    }
  }

  isComplete(status: AskStatus, now: number): boolean {
    if (!this.sawNewResponse || !this.isFresh(status.response)) return false;
    if (status.status === "completed") return true;
    if (status.hasStopButton) return false;
    if (status.isStable) return true;
    return (
      now - this.lastActivityAt > ASK_TIMING.idleMs &&
      status.response.length > IDLE_ANSWER_MIN_LENGTH
    );
  }

  private showsNewProse(prose: ProseState): boolean {
    return (
      prose.count > this.before.prose.count ||
      (prose.lastText !== "" && prose.lastText !== this.before.prose.lastText)
    );
  }

  /** The response when it is new, or empty when it is the one from before. */
  newResponse(response: string): string {
    return this.isFresh(response) ? response : "";
  }

  private isFresh(response: string): boolean {
    return response !== "" && response !== this.before.response;
  }
}

/** The page's status and steps, with none of its text as a partial answer. */
function pollProgress(
  status: AskStatus,
  taskSteps: readonly string[],
): PollProgress {
  return {
    status: status.status,
    partialAnswer: "",
    currentStep: status.currentStep,
    steps: [...new Set([...taskSteps, ...status.steps])],
    browsingUrl: status.agentBrowsingUrl,
  };
}

/** The tab to reconnect to: Perplexity's main tab, its sidecar, or any page. */
function recoveryPage(targets: readonly AskTarget[]): AskTarget | undefined {
  const pages = targets.filter(isPage);
  return (
    pages.find(
      (page) =>
        page.url.includes("perplexity.ai") && !page.url.includes("sidecar"),
    ) ??
    pages.find((page) => page.url.includes("perplexity.ai")) ??
    pages[0]
  );
}

function isPage(target: AskTarget): boolean {
  return target.type === "page";
}

/** A failed ask, with the page's part apart when a page script threw. */
function failure(error: unknown, notice: ModeNotice): AskOutcome {
  if (error instanceof PromptNotSent && error.pageDetail !== undefined) {
    const { message, pageDetail } = error;
    return { kind: "failed", message, pageDetail, notice };
  }
  if (error instanceof PageScriptFailed) {
    const { message, pageDetail } = error;
    return { kind: "failed", message, pageDetail, notice };
  }
  return { kind: "failed", message: errorMessage(error), notice };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
