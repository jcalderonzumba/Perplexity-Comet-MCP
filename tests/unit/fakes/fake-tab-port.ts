// A fake of the browser's tabs, as the tab choice sees them through its
// port: the targets the browser lists, the tab the port is connected to,
// and the tabs it opens, in virtual time.
//
// Connecting moves `url`, the connected tab's address, to the target's; a
// new tab joins the list, at the address it was opened on, and is not
// connected until a connect. `addressFails` makes the connected tab's
// address unreadable, as it is when the connection has dropped. Every call
// is logged by name in `calls`, so a test can check their order.

import type {
  BrowserTarget,
  TabPort,
} from "../../../src/core/perplexity-tab.js";

export const MAIN_TAB: BrowserTarget = {
  id: "main",
  type: "page",
  url: "https://www.perplexity.ai/search/earlier-thread",
};
export const SIDECAR_TAB: BrowserTarget = {
  id: "sidecar",
  type: "page",
  url: "https://www.perplexity.ai/sidecar?copilot=true",
};
export const USER_TAB: BrowserTarget = {
  id: "user",
  type: "page",
  url: "https://news.example/today",
};
/** A user's page that names Perplexity in its address, as a link out would. */
export const LOOKALIKE_TAB: BrowserTarget = {
  id: "lookalike",
  type: "page",
  url: "https://news.example/out?to=https://www.perplexity.ai/",
};
/** A Perplexity thread whose address names a sidecar, as its title does. */
export const SIDECAR_NAMED_THREAD: BrowserTarget = {
  id: "sidecar-named-thread",
  type: "page",
  url: "https://www.perplexity.ai/search/what-is-a-motorcycle-sidecar-x1",
};

export class FakeTabPort implements TabPort {
  /** Every port call by name, oldest first; tests may log their own steps. */
  public readonly calls: string[] = [];
  public readonly connectedTo: string[] = [];
  /** The address each new tab was opened on, oldest first. */
  public readonly openedAt: string[] = [];
  public waitedMs = 0;

  public targets: BrowserTarget[] = [MAIN_TAB];
  /** The address of the tab the port is connected to. */
  public url = MAIN_TAB.url;
  public addressFails = false;

  async listTargets(): Promise<BrowserTarget[]> {
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

  async pageAddress(): Promise<string> {
    this.calls.push("pageAddress");
    if (this.addressFails) throw new Error("Not connected to Comet.");
    return this.url;
  }

  async newTab(url: string): Promise<BrowserTarget> {
    this.calls.push("newTab");
    this.openedAt.push(url);
    const opened = { id: `opened-${this.openedAt.length}`, type: "page", url };
    this.targets.push(opened);
    return opened;
  }

  async wait(ms: number): Promise<void> {
    this.waitedMs += ms;
  }
}
