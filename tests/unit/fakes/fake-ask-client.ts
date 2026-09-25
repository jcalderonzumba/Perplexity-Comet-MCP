// Fakes of the CDP client and the Comet module the ask port drives.
//
// `FakeAskClient.safeEvaluate` runs the expression in the test's own global
// scope, as `Runtime.evaluate` runs it in the page, and reports a thrown
// error as CDP does, in `exceptionDetails`, without rejecting. Every call is
// logged by name in `calls`, with its argument when it has one.

import type { AskPortClient, AskPortComet } from "../../../src/cdp-ask-port.js";
import type { AskStatus, AskTarget } from "../../../src/core/ask.js";
import type { EvaluateResult } from "../../../src/types.js";

export class FakeAskClient implements AskPortClient {
  public readonly calls: string[] = [];
  public readonly expressions: string[] = [];
  public targets: AskTarget[] = [];
  public mainTab: AskTarget | null = null;
  public preCheckFails = false;
  public onPerplexity = true;
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

  async listTargets(): Promise<AskTarget[]> {
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

  async listTabsCategorized(): Promise<{ main: AskTarget | null }> {
    this.calls.push("listTabsCategorized");
    return { main: this.mainTab };
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

  async isOnPerplexityTab(): Promise<boolean> {
    this.calls.push("isOnPerplexityTab");
    return this.onPerplexity;
  }

  async ensureOnPerplexityTab(): Promise<boolean> {
    this.calls.push("ensureOnPerplexityTab");
    return this.onPerplexity;
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
  isStable: false,
};

export class FakeAskComet implements AskPortComet {
  public readonly calls: string[] = [];
  public status: AskStatus = WORKING_STATUS;
  public sendFailure: Error | undefined;

  async getAgentStatus(): Promise<AskStatus> {
    this.calls.push("getAgentStatus");
    return this.status;
  }

  resetStabilityTracking(): void {
    this.calls.push("resetStabilityTracking");
  }

  async sendPrompt(prompt: string): Promise<string> {
    this.calls.push(`sendPrompt ${prompt}`);
    if (this.sendFailure) throw this.sendFailure;
    return "Prompt sent";
  }
}
