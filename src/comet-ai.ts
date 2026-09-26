// Comet AI interaction module
// Reads the state of Comet's answer and stops it. Prompts are sent by the
// ask core's send step (`core/ask-send.ts`), with trusted CDP input.

import { cometClient } from "./cdp-client.js";
import { type AgentStatusResult, extractAgentStatus } from "./page-scripts.js";

/**
 * Minimal CDP-client surface used by `CometAI.getAgentStatus`. Letting
 * callers inject a stand-in (in unit tests) avoids spinning up real
 * CDP infrastructure to exercise the status-extraction logic. Methods
 * outside this set continue to use the module-level `cometClient`.
 */
export type CometAIClient = Pick<
  typeof cometClient,
  "safeEvaluate" | "listTabsCategorized"
>;

export class CometAI {
  private readonly client: CometAIClient;

  constructor(client: CometAIClient = cometClient) {
    this.client = client;
  }

  // Track response stability for completion detection.
  // Semantics: returns `true` once the same response has been observed
  // for `STABLE_REPEATS_REQUIRED` consecutive polls AFTER the first
  // sighting. So with the default 2: call 1 records the value (false),
  // call 2 matches (count=1, false), call 3 matches (count=2, true).
  // Effectively "the response has not changed across the last 3 polls".
  // The previous comment claimed "same for 2 checks" which was off by
  // one; renaming the constant to match what the code actually does.
  private lastResponseText: string = "";
  private stableResponseCount: number = 0;
  private readonly STABLE_REPEATS_REQUIRED: number = 2;

  /**
   * Check if response has stabilized.
   *
   * Returns `true` once the response text has been observed unchanged
   * for `STABLE_REPEATS_REQUIRED + 1` consecutive polls.
   */
  isResponseStable(currentResponse: string): boolean {
    if (currentResponse && currentResponse.length > 50) {
      if (currentResponse === this.lastResponseText) {
        this.stableResponseCount++;
      } else {
        this.stableResponseCount = 0;
        this.lastResponseText = currentResponse;
      }
      return this.stableResponseCount >= this.STABLE_REPEATS_REQUIRED;
    }
    return false;
  }

  /**
   * Reset stability tracking (call when starting new prompt)
   */
  resetStabilityTracking(): void {
    this.lastResponseText = "";
    this.stableResponseCount = 0;
  }

  /**
   * Get current agent status and progress (for polling)
   */
  async getAgentStatus(): Promise<{
    status: "idle" | "working" | "completed";
    steps: string[];
    currentStep: string;
    response: string;
    hasStopButton: boolean;
    agentBrowsingUrl: string;
    isStable: boolean;
  }> {
    // Get browsing URL from agent's tab
    let agentBrowsingUrl = "";
    try {
      const tabs = await this.client.listTabsCategorized();
      if (tabs.agentBrowsing) {
        agentBrowsingUrl = tabs.agentBrowsing.url;
      }
    } catch {
      // Continue without URL
    }

    const result = await this.client.safeEvaluate(
      `(${extractAgentStatus.toString()})()`,
    );

    const statusResult = result.result.value as AgentStatusResult;

    // Check response stability
    const isStable = this.isResponseStable(statusResult.response);

    // If response is stable and has content, override status to completed
    if (
      isStable &&
      statusResult.response.length > 50 &&
      !statusResult.hasStopButton
    ) {
      statusResult.status = "completed";
    }

    return {
      ...statusResult,
      agentBrowsingUrl,
      isStable,
    };
  }

  /**
   * Stop the current agent task
   */
  async stopAgent(): Promise<boolean> {
    const result = await cometClient.evaluate(`
      (() => {
        // Try aria-label buttons first
        for (const btn of document.querySelectorAll('button[aria-label*="Stop"], button[aria-label*="Cancel"]')) {
          btn.click();
          return true;
        }
        // Try square stop icon
        for (const btn of document.querySelectorAll('button')) {
          if (btn.querySelector('svg rect')) {
            btn.click();
            return true;
          }
        }
        return false;
      })()
    `);
    return result.result.value as boolean;
  }
}

export const cometAI = new CometAI();
