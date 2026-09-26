// Comet AI interaction module
// Reads the state of Comet's answer. Prompts are sent, and answers stopped,
// by the ask core (`core/ask-send.ts`, `core/ask-stop.ts`), with trusted
// CDP input.

import { cometClient } from "./cdp-client.js";
import { type AgentStatusResult, extractAgentStatus } from "./page-scripts.js";

/**
 * Minimal CDP-client surface used by `CometAI.getAgentStatus`. Letting
 * callers inject a stand-in (in unit tests) avoids spinning up real
 * CDP infrastructure to exercise the status-extraction logic.
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

  /**
   * The answer's status as the page script reads it, with the address of
   * the tab the agent is browsing. The page reads an answer only once it is
   * complete, so the status is reported as read, never inferred from how
   * long the text has stayed the same.
   */
  async getAgentStatus(): Promise<{
    status: "idle" | "working" | "completed";
    steps: string[];
    currentStep: string;
    response: string;
    hasStopButton: boolean;
    agentBrowsingUrl: string;
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

    return {
      ...(result.result.value as AgentStatusResult),
      agentBrowsingUrl,
    };
  }
}

export const cometAI = new CometAI();
