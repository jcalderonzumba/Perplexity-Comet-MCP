// A fake of the browser's tabs as `comet_tabs` sees them through its port:
// the targets the browser lists, the tab the connection is on, and the
// connects and closes asked of it. Every call is logged by name in `calls`,
// so a test can show that a refusal reached the port with nothing.

import type { BrowserTarget } from "../../../src/core/perplexity-tab.js";
import type { OpenedTabs, TabsPort } from "../../../src/core/tabs.js";

export const OPENED_MAIN: BrowserTarget = {
  id: "0a1b2c3d-1111-4222-8333-444455556666",
  type: "page",
  url: "https://www.perplexity.ai/search/thread-x1",
};
export const UNRECORDED_MAIN: BrowserTarget = {
  id: "0a1b2c3d-2222-4222-8333-444455556666",
  type: "page",
  url: "https://www.perplexity.ai/",
};
export const SIDECAR: BrowserTarget = {
  id: "0a1b2c3d-3333-4222-8333-444455556666",
  type: "page",
  url: "https://www.perplexity.ai/sidecar?copilot=true",
};
export const USERS_TAB: BrowserTarget = {
  id: "0a1b2c3d-4444-4222-8333-444455556666",
  type: "page",
  url: "https://github.com/octo/widgets",
};
export const AGENTS_TAB: BrowserTarget = {
  id: "0a1b2c3d-5555-4222-8333-444455556666",
  type: "page",
  url: "https://gist.example.org/agent",
};
export const NEW_TAB_PAGE: BrowserTarget = {
  id: "0a1b2c3d-6666-4222-8333-444455556666",
  type: "page",
  url: "chrome://newtab/",
};
export const SERVICE_WORKER: BrowserTarget = {
  id: "0a1b2c3d-7777-4222-8333-444455556666",
  type: "service_worker",
  url: "https://github.com/sw.js",
};
export const UNKNOWN_ID = "0a1b2c3d-9999-4222-8333-444455556666";

/** The record of the tabs the server opened, holding `ids`. */
export function recordOf(...ids: string[]): OpenedTabs {
  return { opened: (id) => ids.includes(id) };
}

export class FakeTabsPort implements TabsPort {
  /** Every port call by name, oldest first. */
  public readonly calls: string[] = [];
  public readonly connectedTo: string[] = [];
  public readonly closed: string[] = [];

  public targets: BrowserTarget[];
  /** The tab the connection is on. */
  public connected: string | null = null;
  /** Whether the browser reports a close as done. */
  public closeSucceeds = true;

  constructor(...targets: BrowserTarget[]) {
    this.targets = targets;
  }

  async listTargets(): Promise<BrowserTarget[]> {
    this.calls.push("listTargets");
    return [...this.targets];
  }

  connectedTabId(): string | null {
    this.calls.push("connectedTabId");
    return this.connected;
  }

  async connect(targetId: string): Promise<void> {
    this.calls.push("connect");
    this.connectedTo.push(targetId);
  }

  async close(targetId: string): Promise<boolean> {
    this.calls.push("close");
    this.closed.push(targetId);
    return this.closeSucceeds;
  }
}
