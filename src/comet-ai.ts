// Comet AI interaction module
// Reads what the ask port cannot read from the page: the address of the tab
// the agent is browsing. The answer's status is read by the ask port
// (`cdp-ask-port.ts`) with page scripts; prompts are sent, and answers
// stopped, by the ask core (`core/ask-send.ts`, `core/ask-stop.ts`), with
// trusted CDP input.

import { cometClient } from "./cdp-client.js";

/**
 * Minimal CDP-client surface used by `CometAI`. Letting callers inject a
 * stand-in (in unit tests) avoids spinning up real CDP infrastructure.
 */
export type CometAIClient = Pick<typeof cometClient, "listTabsCategorized">;

export class CometAI {
  private readonly client: CometAIClient;

  constructor(client: CometAIClient = cometClient) {
    this.client = client;
  }

  /** The address of the tab the agent is browsing, or empty when there is none. */
  async agentBrowsingUrl(): Promise<string> {
    try {
      const tabs = await this.client.listTabsCategorized();
      return tabs.agentBrowsing?.url ?? "";
    } catch {
      return "";
    }
  }
}

export const cometAI = new CometAI();
