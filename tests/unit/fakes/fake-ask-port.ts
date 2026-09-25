// A fake of the port `AskCore` drives: a model of Comet's tabs and of the
// Perplexity page an ask reads, in virtual time.
//
// Before the prompt is sent the page shows `before`. Once it is sent, each
// read of the prose state is one poll: it moves to the next of `after`, and
// the last one stays. An `Error` in `after` makes that poll's reads throw,
// as a CDP call does when the page goes away; an `Error` as `before` makes
// the reads before sending throw. Time only passes through
// `wait`. Every call is logged by name in `calls`, where a test can log
// other steps too, so it can check their order.

import type { AskPort, AskStatus, AskTarget } from "../../../src/core/ask.js";
import type { ProseState } from "../../../src/page-scripts.js";

/** What one read of the page shows: its prose blocks and its status. */
export interface PageReading {
  readonly prose: ProseState;
  readonly status: AskStatus;
}

export const MAIN_TAB: AskTarget = {
  id: "main",
  type: "page",
  url: "https://www.perplexity.ai/search/earlier-thread",
};
export const SIDECAR_TAB: AskTarget = {
  id: "sidecar",
  type: "page",
  url: "https://www.perplexity.ai/sidecar?x=1",
};
export const USER_TAB: AskTarget = {
  id: "user",
  type: "page",
  url: "https://news.example/today",
};

/**
 * The page showing `response`: by default one prose block more than a quiet
 * page, still working, not stable, with no stop button.
 */
export function reading(
  response: string,
  options: Partial<AskStatus> & { proseCount?: number } = {},
): PageReading {
  const { proseCount = 1, ...status } = options;
  return {
    prose: { count: proseCount, lastText: response.slice(0, 100) },
    status: {
      status: "working",
      steps: [],
      currentStep: "",
      response,
      hasStopButton: false,
      isStable: false,
      agentBrowsingUrl: "",
      ...status,
    },
  };
}

/** A Perplexity page with no answer on it. */
export const QUIET_PAGE: PageReading = reading("", {
  status: "idle",
  proseCount: 0,
});

export class FakeAskPort implements AskPort {
  /** Every port call by name, oldest first; tests may log their own steps. */
  public readonly calls: string[] = [];
  public readonly sentPrompts: string[] = [];
  public readonly cometPorts: number[] = [];
  public readonly connectedTo: string[] = [];
  public readonly navigations: string[] = [];
  public waitedMs = 0;

  public targets: AskTarget[] = [MAIN_TAB];
  /** The address of the tab the port is connected to. */
  public url = MAIN_TAB.url;
  public before: PageReading | Error = QUIET_PAGE;
  public after: Array<PageReading | Error> = [];

  public preCheckFails = false;
  public recoveryFails = false;
  public navigationFails = false;
  public sendFailure: Error | undefined;
  public onPerplexityTab = true;
  /** Whether the page shows a control that stops the answer. */
  public hasStopControl = true;
  /** Runs on every navigation, as a real one resets the page's mode. */
  public onNavigate: (() => void) | undefined;

  private sent = false;
  private poll = -1;

  async preOperationCheck(): Promise<void> {
    this.calls.push("preOperationCheck");
    if (this.preCheckFails) throw new Error("WebSocket is not open");
  }

  async startComet(port: number): Promise<string> {
    this.calls.push("startComet");
    this.cometPorts.push(port);
    if (this.recoveryFails) throw new Error("Comet did not start");
    return "Comet started";
  }

  async listTargets(): Promise<AskTarget[]> {
    this.calls.push("listTargets");
    return [...this.targets];
  }

  async connect(targetId: string): Promise<string> {
    this.calls.push("connect");
    this.connectedTo.push(targetId);
    const target = this.targets.find((candidate) => candidate.id === targetId);
    if (target) this.url = target.url;
    return `Connected to ${targetId}`;
  }

  async ensureConnection(): Promise<void> {
    this.calls.push("ensureConnection");
  }

  async navigate(url: string, _waitForLoad: boolean): Promise<void> {
    this.calls.push("navigate");
    if (this.navigationFails) throw new Error("Navigation failed");
    this.navigations.push(url);
    this.url = url;
    this.onNavigate?.();
  }

  async mainTab(): Promise<AskTarget | null> {
    this.calls.push("mainTab");
    return (
      this.targets.find(
        (target) =>
          target.url.includes("perplexity.ai") &&
          !target.url.includes("sidecar"),
      ) ?? null
    );
  }

  async currentUrl(): Promise<string> {
    this.calls.push("currentUrl");
    return this.url;
  }

  async isOnPerplexityTab(): Promise<boolean> {
    return this.onPerplexityTab;
  }

  async ensureOnPerplexityTab(): Promise<boolean> {
    return this.onPerplexityTab;
  }

  async readProseState(): Promise<ProseState> {
    this.calls.push("readProseState");
    if (this.sent) this.poll++;
    return this.current().prose;
  }

  async readStatus(): Promise<AskStatus> {
    this.calls.push("readStatus");
    return this.current().status;
  }

  resetStabilityTracking(): void {
    this.calls.push("resetStabilityTracking");
  }

  async sendPrompt(prompt: string): Promise<string> {
    this.calls.push("sendPrompt");
    if (this.sendFailure) throw this.sendFailure;
    this.sentPrompts.push(prompt);
    this.sent = true;
    return "Prompt sent";
  }

  async stopAgent(): Promise<boolean> {
    this.calls.push("stopAgent");
    return this.hasStopControl;
  }

  now(): number {
    return this.waitedMs;
  }

  async wait(ms: number): Promise<void> {
    this.waitedMs += ms;
  }

  /** How many polls read the page after the prompt was sent. */
  get polls(): number {
    return this.poll + 1;
  }

  private current(): PageReading {
    const shown = this.shown();
    if (shown instanceof Error) throw shown;
    return shown;
  }

  private shown(): PageReading | Error {
    if (!this.sent || this.after.length === 0) return this.before;
    const index = Math.min(Math.max(this.poll, 0), this.after.length - 1);
    return this.after[index];
  }
}
