// The ask core: `comet_ask` once, for every adapter alike, over a small port
// each adapter satisfies with its CDP client and Comet module.
//
// An ask validates its arguments before anything reaches the browser,
// shapes the prompt, brings the connection to Perplexity's main page (by
// `ask-tab.ts`, never the sidecar or a user's page), puts back
// the mode `comet_mode` last set, sends the prompt (typed and submitted
// with trusted input by `ask-send.ts`), and waits for its answer: the one
// the page reads as completed, of any length, in a turn after the one the
// page showed before the prompt was sent (`thread-turn.ts`), so an earlier
// turn's answer never stands in for it, even one with the same text. When
// its time runs out it says so and keeps the task active, so the answer is
// never presented as complete before it is. The outcome is data;
// `describeAskOutcome` words it, and the adapter wraps the page text in it.
//
// `comet_poll` and `comet_stop` follow the same task. A poll of a task the
// ask left running applies the ask's completion rules, against the page as
// it was before the prompt was sent, so it returns the answer only once it
// is complete and new, and otherwise says the task is still working. Stop
// clicks the input bar's stop control (`ask-stop.ts`) and ends the task: an
// ask still waiting then returns saying it was stopped, and a poll reports
// the task stopped, reading no page. A poll after an ask whose prompt was
// never sent says so, and reads no page either.

import { errorMessage } from "../error-message.js";
import { AnswerWatch, type PageBefore } from "./answer-watch.js";
import {
  type AskRequest,
  readAskRequest,
  shapePrompt,
  withContext,
} from "./ask-input.js";
import { type ModeNotice, reapplyModeBeforeAsk } from "./ask-mode.js";
import { PromptNotSent, type PromptPort, sendPrompt } from "./ask-send.js";
import { type StopOutcome, type StopPort, stopAnswer } from "./ask-stop.js";
import { AskTab, type AskTabPort } from "./ask-tab.js";
import { AskTaskState } from "./ask-task.js";
import type { ModeTool } from "./mode-tool.js";
import { PageScriptFailed } from "./page-script-failed.js";
import type { PerplexityTab } from "./perplexity-tab.js";

export { PageScriptFailed, type StopOutcome };

/** What the page shows about the answer, as the Comet module reads it. */
export interface AskStatus {
  readonly status: "idle" | "working" | "completed";
  readonly steps: readonly string[];
  readonly currentStep: string;
  /** The latest turn's answer, whole; empty unless the status is completed. */
  readonly response: string;
  readonly hasStopButton: boolean;
  /** The address of the tab the agent is browsing, or empty. */
  readonly agentBrowsingUrl: string;
}

/**
 * What the ask core needs from the browser, the send step's, the stop's and
 * the tab's needs among them; each adapter supplies one. A read through a
 * page script rejects with `PageScriptFailed` when the script throws in the
 * page.
 */
export interface AskPort extends PromptPort, StopPort, AskTabPort {
  readStatus(): Promise<AskStatus>;
}

/** The ask's waits, in milliseconds. */
export const ASK_TIMING = {
  /** Between two reads of the page while waiting for the answer. */
  pollMs: 1500,
} as const;

/** Failed reads in a row after which the connection itself is re-checked. */
const MAX_CONSECUTIVE_ERRORS = 5;

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
    }
  /**
   * The task ended while the ask waited for its answer: `comet_stop` stopped
   * it, or a newer ask replaced it.
   */
  | {
      readonly kind: "stopped";
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
  /**
   * The last task's prompt never reached Comet: there is nothing to follow,
   * whatever the page shows.
   */
  | { readonly kind: "not-sent" }
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
   * The task was stopped before its answer was complete; the page is not
   * read, so none of its text is taken for the answer.
   */
  | {
      readonly kind: "stopped";
      readonly taskId: string | null;
      readonly steps: readonly string[];
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

export interface AskCoreOptions {
  readonly port: AskPort;
  /** The mode tool whose remembered mode the ask puts back. */
  readonly mode: Pick<ModeTool, "core" | "quotePage">;
  /**
   * The tab choice, shared with that mode tool, so the one record of the
   * tabs the server opened holds the ones either opened.
   */
  readonly perplexity: PerplexityTab;
  /** The debug port Comet is started on when the connection is lost. */
  readonly cometPort: number;
}

/**
 * Asks Comet and waits for the answer. Each adapter creates one when it
 * starts, so the task it follows lives as long as the server and belongs
 * to it alone.
 */
export class AskCore {
  readonly task: AskTaskState;
  /** The connection and the tab the ask runs in. */
  readonly tab: AskTab;
  private readonly port: AskPort;
  /** The completion rules of the task's answer, once its prompt is sent. */
  private watch: AnswerWatch | null = null;

  constructor(private readonly options: AskCoreOptions) {
    this.port = options.port;
    this.task = new AskTaskState(() => options.port.now());
    this.tab = new AskTab(options.port, options.cometPort, options.perplexity);
  }

  async ask(args: Record<string, unknown> | undefined): Promise<AskOutcome> {
    const reading = readAskRequest(args);
    if (!reading.ok) return { kind: "refused", reason: reading.reason };
    const { request } = reading;
    const prompt = withContext(request.prompt, request.context);
    const taskId = this.task.start(prompt);
    this.watch = null;
    const outcome = await this.connectSendAndWait(request, prompt, taskId);
    if (outcome.kind === "failed" && !this.sentPromptOf(taskId)) {
      this.task.abandon(taskId);
    }
    return outcome;
  }

  /** Whether the prompt of the task `taskId` reached Comet. */
  private sentPromptOf(taskId: string): boolean {
    return this.watch !== null && this.watch.taskId === taskId;
  }

  /** The ask once its task has started, any failure as an outcome. */
  private async connectSendAndWait(
    request: AskRequest,
    prompt: string,
    taskId: string,
  ): Promise<AskOutcome> {
    let notice = NO_NOTICE;
    try {
      if (!(await this.tab.connectOrRecover())) {
        return { kind: "failed", message: CONNECTION_FAILED, notice };
      }
      await this.tab.bringToAskPage(request.newChat);
      notice = await reapplyModeBeforeAsk(this.options.mode);
      return await this.sendAndWait(shapePrompt(prompt), {
        taskId,
        timeoutMs: request.timeoutMs,
        notice,
      });
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
    if (task.state === "none") return { kind: "no-task" };
    if (!task.isActive && task.isStale()) return { kind: "expired" };
    switch (task.state) {
      case "not-sent":
        return { kind: "not-sent" };
      case "stopped":
        return {
          kind: "stopped",
          taskId: task.currentTaskId,
          steps: [...task.steps],
        };
      case "completed":
        return {
          kind: "completed",
          answer: task.lastResponse ?? "",
          secondsAgo: this.secondsSince(task.lastResponseTime),
        };
    }
    await this.tab.returnToMainPage();
    const { watch } = this;
    if (watch && task.isFollowing(watch.taskId)) {
      return this.followOrReport(watch);
    }
    return this.pageStatusWhileSending();
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

  /**
   * Stops the answer in progress in Perplexity's main page, and ends the
   * task when it stopped. The sidecar and the user's pages are never
   * looked at: with no main page open, there is nothing to stop.
   */
  async stop(): Promise<StopOutcome> {
    if (!(await this.tab.returnToMainPage())) {
      return { kind: "nothing-to-stop" };
    }
    const outcome = await stopAnswer(this.port);
    if (outcome.kind === "stopped") this.task.stop();
    return outcome;
  }

  /** One read of the page, judged by the ask's completion rules. */
  private async follow(watch: AnswerWatch): Promise<PollOutcome> {
    const thread = await this.port.readThreadState();
    const status = await this.port.readStatus();
    watch.observe(thread, status);
    this.task.recordSteps(watch.steps);
    if (watch.isComplete(status)) {
      this.task.complete(watch.taskId, status.response);
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

  /** The page's status, for a task whose prompt is still being sent. */
  private async pageStatusWhileSending(): Promise<PollOutcome> {
    const status = await this.port.readStatus();
    return {
      kind: "working",
      taskId: this.task.currentTaskId,
      progress: pollProgress(status, this.task.steps),
    };
  }

  private secondsSince(then: number | null): number {
    return then === null ? 0 : Math.round((this.port.now() - then) / 1000);
  }

  private async sendAndWait(
    prompt: string,
    wait: AnswerWait,
  ): Promise<AskOutcome> {
    const before = await this.readPageBefore();
    await sendPrompt(this.port, prompt, before.thread);
    this.watch = new AnswerWatch(wait.taskId, before);
    return this.waitForAnswer(this.watch, wait);
  }

  private async readPageBefore(): Promise<PageBefore> {
    const thread = await this.port.readThreadState();
    try {
      return { thread, response: (await this.port.readStatus()).response };
    } catch {
      // Without it, freshness still requires a non-empty response.
      return { thread, response: "" };
    }
  }

  /**
   * Reads the page until the answer is complete, the task is no longer the
   * one followed (stopped, or replaced by a newer ask), or time runs out.
   */
  private async waitForAnswer(
    watch: AnswerWatch,
    { taskId, timeoutMs, notice }: AnswerWait,
  ): Promise<AskOutcome> {
    const startedAt = this.port.now();
    let errors = 0;
    while (this.port.now() - startedAt < timeoutMs) {
      await this.port.wait(ASK_TIMING.pollMs);
      if (!this.task.isFollowing(taskId)) return this.stopped(watch, notice);
      try {
        if (!(await this.tab.returnToMainPage())) {
          errors++;
          continue;
        }
        const thread = await this.port.readThreadState();
        const status = await this.port.readStatus();
        errors = 0;
        watch.observe(thread, status);
        if (!this.task.isFollowing(taskId)) return this.stopped(watch, notice);
        this.task.recordSteps(watch.steps);
        if (watch.isComplete(status)) {
          this.task.complete(taskId, status.response);
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

  private async stopped(
    watch: AnswerWatch,
    notice: ModeNotice,
  ): Promise<AskOutcome> {
    return {
      kind: "stopped",
      progress: await this.progressSoFar(watch),
      notice,
    };
  }

  /**
   * After a failed read: the errors in a row that remain once the tab is
   * back on Perplexity, or undefined when the connection cannot be kept.
   */
  private async recoverFromFailedRead(
    errors: number,
  ): Promise<number | undefined> {
    try {
      if (await this.tab.returnToMainPage()) return errors - 1;
    } catch {
      // Fall through to the connection check.
    }
    if (errors < MAX_CONSECUTIVE_ERRORS) return errors;
    try {
      await this.port.ensureConnection();
      await this.tab.returnToMainPage();
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

/** The task an ask waits for, how long, and the notice its result carries. */
interface AnswerWait {
  readonly taskId: string;
  readonly timeoutMs: number;
  readonly notice: ModeNotice;
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
