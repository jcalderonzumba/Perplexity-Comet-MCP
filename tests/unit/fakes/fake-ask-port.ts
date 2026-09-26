// A fake of the port `AskCore` drives: a model of Comet's tabs (the tab
// fake's, which it extends), of the Perplexity page an ask reads, and of its
// input bar, in virtual time.
//
// The prompt is sent once `inputBar`, the fake input bar, takes it as
// submitted. Before that the page shows `before`. Once it is sent, each
// read of the thread state is one poll: it moves to the next of `after`, and
// the last one stays. An `Error` in `after` makes that poll's reads throw,
// as a CDP call does when the page goes away; an `Error` as `before` makes
// the reads before sending throw. Time only passes through
// `wait`. Every call is logged by name in `calls`, where a test can log
// other steps too, so it can check their order. `typedIn` records the
// address of the connected tab each time text is inserted, so a test can
// check which tab the prompt reached.

import type { AskPort, AskStatus } from "../../../src/core/ask.js";
import type { PagePoint, ThreadState } from "../../../src/page-scripts.js";
import { FakeInputBar } from "./fake-input-bar.js";
import { FakeTabPort } from "./fake-tab-port.js";

/** What one read of the page shows: its thread's turns and its status. */
export interface PageReading {
  readonly thread: ThreadState;
  readonly status: AskStatus;
}

/**
 * The page showing `response`: by default the first turn of a thread, still
 * working, with no stop button.
 */
export function reading(
  response: string,
  options: Partial<AskStatus> & {
    latestTurn?: number | null;
    proseCount?: number;
  } = {},
): PageReading {
  const { latestTurn = 0, proseCount = 1, ...status } = options;
  return {
    thread: {
      latestTurn,
      proseCount,
      lastProseText: response.slice(0, 100),
    },
    status: {
      status: "working",
      steps: [],
      currentStep: "",
      response,
      hasStopButton: false,
      agentBrowsingUrl: "",
      ...status,
    },
  };
}

/** A Perplexity page with no answer on it. */
export const QUIET_PAGE: PageReading = reading("", {
  status: "idle",
  latestTurn: null,
  proseCount: 0,
});

export class FakeAskPort extends FakeTabPort implements AskPort {
  public readonly sentPrompts: string[] = [];
  public readonly cometPorts: number[] = [];
  public readonly navigations: string[] = [];
  /** The connected tab's address at each text insertion, oldest first. */
  public readonly typedIn: string[] = [];

  public before: PageReading | Error = QUIET_PAGE;
  public after: Array<PageReading | Error> = [];

  /** The input bar the prompt is typed into; its knobs fail each step. */
  public readonly inputBar = new FakeInputBar();

  public preCheckFails = false;
  public recoveryFails = false;
  public navigationFails = false;
  /** Runs on every navigation, as a real one resets the page's mode. */
  public onNavigate: (() => void) | undefined;
  /**
   * When set, the answer in progress, whose stop control the input bar
   * shows, finishes once the clock reaches this time.
   */
  public answeringUntilMs: number | null = null;
  /**
   * Runs at each poll after the prompt was sent, with its number from 0,
   * before the poll's reads return: what happens while the ask waits.
   */
  public onPoll: ((poll: number) => void | Promise<void>) | undefined;
  /**
   * Runs after every wait, once the clock has moved: what happens while the
   * core waits, before its prompt is sent as after.
   */
  public onWait: (() => void | Promise<void>) | undefined;

  private sent = false;
  private poll = -1;

  constructor() {
    super();
    this.inputBar.onSubmit = (prompt) => {
      this.sentPrompts.push(prompt);
      this.sent = true;
    };
  }

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

  async ensureConnection(): Promise<void> {
    this.calls.push("ensureConnection");
  }

  async navigate(url: string, _waitForLoad: boolean): Promise<void> {
    this.calls.push("navigate");
    if (this.navigationFails) throw new Error("Navigation failed");
    this.navigations.push(url);
    this.url = url;
    // A new page shows no answer in progress.
    this.inputBar.answering = false;
    this.onNavigate?.();
  }

  /**
   * The page as the next ask finds it: `before` until its prompt is sent,
   * then `after`, poll by poll, as for the first ask.
   */
  nextAsk(before: PageReading, after: Array<PageReading | Error>): void {
    this.before = before;
    this.after = after;
    this.sent = false;
    this.poll = -1;
  }

  async readThreadState(): Promise<ThreadState> {
    this.calls.push("readThreadState");
    if (this.sent) {
      this.poll++;
      await this.onPoll?.(this.poll);
    }
    return this.current().thread;
  }

  async readStatus(): Promise<AskStatus> {
    this.calls.push("readStatus");
    return this.current().status;
  }

  selectAskInput(): Promise<boolean> {
    this.calls.push("selectAskInput");
    return this.inputBar.selectAskInput();
  }

  readAskInput(): Promise<string | null> {
    this.calls.push("readAskInput");
    return this.inputBar.readAskInput();
  }

  insertText(text: string): Promise<void> {
    this.calls.push("insertText");
    this.typedIn.push(this.url);
    return this.inputBar.insertText(text);
  }

  pressEnter(): Promise<void> {
    this.calls.push("pressEnter");
    return this.inputBar.pressEnter();
  }

  locateSubmitButton(): Promise<PagePoint | null> {
    this.calls.push("locateSubmitButton");
    return this.inputBar.locateSubmitButton();
  }

  clickAt(point: PagePoint): Promise<void> {
    this.calls.push("clickAt");
    return this.inputBar.clickAt(point);
  }

  startFocusEmulation(): Promise<void> {
    this.calls.push("startFocusEmulation");
    return this.inputBar.startFocusEmulation();
  }

  stopFocusEmulation(): Promise<void> {
    this.calls.push("stopFocusEmulation");
    return this.inputBar.stopFocusEmulation();
  }

  locateStopControl(): Promise<PagePoint | null> {
    this.calls.push("locateStopControl");
    if (
      this.answeringUntilMs !== null &&
      this.waitedMs >= this.answeringUntilMs
    ) {
      this.inputBar.answering = false;
      this.answeringUntilMs = null;
    }
    return this.inputBar.locateStopControl();
  }

  override async wait(ms: number): Promise<void> {
    await super.wait(ms);
    await this.onWait?.();
  }

  now(): number {
    return this.waitedMs;
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
