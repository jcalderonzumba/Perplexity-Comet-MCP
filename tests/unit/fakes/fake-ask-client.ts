// Fakes of the CDP client and the Comet module the ask port drives.
//
// `FakeAskClient.safeEvaluate` runs the expression in the test's own global
// scope, as `Runtime.evaluate` runs it in the page, and reports a thrown
// error as CDP does, in `exceptionDetails`, without rejecting. Its trusted
// text lands in the focused element, as `Input.insertText` does, and its
// Enter submits what that element holds and empties it, as Perplexity's
// input bar does. It also serves as the tab choice's client, reading the
// connected tab's `address` and opening tabs. Every call is logged by name
// in `calls`, with its argument when it has one.

import type { AskPortClient, AskPortComet } from "../../../src/cdp-ask-port.js";
import type { TrustedKey } from "../../../src/cdp-client.js";
import type { TabClient } from "../../../src/cdp-perplexity-tab.js";
import type { AskStatus } from "../../../src/core/ask.js";
import type { BrowserTarget } from "../../../src/core/perplexity-tab.js";
import type { PagePoint } from "../../../src/page-scripts.js";
import type { EvaluateResult } from "../../../src/types.js";

export class FakeAskClient implements AskPortClient, TabClient {
  public readonly calls: string[] = [];
  public readonly expressions: string[] = [];
  /** Every text given to the trusted insertion. */
  public readonly inserted: string[] = [];
  /** Every text an Enter submitted from the focused element. */
  public readonly submitted: string[] = [];
  public targets: BrowserTarget[] = [];
  /** The connected tab's address, as the browser reports it. */
  public address = "https://www.perplexity.ai/";
  public preCheckFails = false;
  /** When set, every page script fails in the page with this error. */
  public pageFailure: string | undefined;

  async preOperationCheck(): Promise<void> {
    this.calls.push("preOperationCheck");
    if (this.preCheckFails) throw new Error("WebSocket is not open");
  }

  async startComet(port: number): Promise<string> {
    this.calls.push(`startComet ${port}`);
    return "Comet started";
  }

  async listTargets(): Promise<BrowserTarget[]> {
    this.calls.push("listTargets");
    return [...this.targets];
  }

  async connect(targetId: string): Promise<string> {
    this.calls.push(`connect ${targetId}`);
    return `Connected to ${targetId}`;
  }

  async ensureConnection(): Promise<void> {
    this.calls.push("ensureConnection");
  }

  async navigate(url: string, waitForLoad = true): Promise<void> {
    this.calls.push(`navigate ${url} wait=${waitForLoad}`);
  }

  async pageAddress(): Promise<string> {
    this.calls.push("pageAddress");
    return this.address;
  }

  async newTab(url: string): Promise<BrowserTarget> {
    this.calls.push(`newTab ${url}`);
    return { id: "new-tab", type: "page", url };
  }

  async safeEvaluate(expression: string): Promise<EvaluateResult> {
    this.expressions.push(expression);
    if (this.pageFailure) return failedInPage(this.pageFailure);
    try {
      // biome-ignore lint/security/noGlobalEval: the fake runs page expressions as CDP's Runtime.evaluate does
      const value: unknown = globalThis.eval(expression);
      return { result: { type: typeof value, value } };
    } catch (error) {
      return failedInPage(String(error));
    }
  }

  async insertText(text: string): Promise<void> {
    this.calls.push(`insertText ${text}`);
    this.inserted.push(text);
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused !== document.body) {
      focused.textContent = text;
    }
  }

  async pressKey(key: TrustedKey): Promise<void> {
    this.calls.push(`pressKey ${key}`);
    const focused = document.activeElement;
    if (key !== "Enter" || !(focused instanceof HTMLElement)) return;
    if (focused === document.body || !focused.textContent) return;
    this.submitted.push(focused.textContent);
    focused.textContent = "";
  }

  async clickAt(point: PagePoint): Promise<void> {
    this.calls.push(`clickAt ${point.x},${point.y}`);
  }

  async startFocusEmulation(): Promise<void> {
    this.calls.push("startFocusEmulation");
  }

  async stopFocusEmulation(): Promise<void> {
    this.calls.push("stopFocusEmulation");
  }
}

function failedInPage(description: string): EvaluateResult {
  return {
    result: { type: "object" },
    exceptionDetails: { text: "Uncaught", exception: { description } },
  };
}

export const WORKING_STATUS: AskStatus = {
  status: "working",
  steps: ["Searching"],
  currentStep: "Searching",
  response: "Paris is",
  hasStopButton: true,
  agentBrowsingUrl: "",
};

export class FakeAskComet implements AskPortComet {
  public readonly calls: string[] = [];
  public status: AskStatus = WORKING_STATUS;

  async getAgentStatus(): Promise<AskStatus> {
    this.calls.push("getAgentStatus");
    return this.status;
  }
}
