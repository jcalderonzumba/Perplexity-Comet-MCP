// The tab choice over the CDP client: the one `PerplexityTab` each adapter
// builds when it starts and hands to both its `comet_ask` core and its
// `comet_mode` tool. Sharing it keeps one record of the tabs the server
// opened, whichever tool opened them, for whatever later closes tabs by
// that record (principle 6: never a tab the server did not open).

import {
  type BrowserTarget,
  PerplexityTab,
  type TabPort,
} from "./core/perplexity-tab.js";

/** The part of the CDP client the tab choice drives. */
export interface TabClient {
  listTargets(): Promise<readonly BrowserTarget[]>;
  connect(targetId: string): Promise<unknown>;
  /** The connected tab's top-frame address, read through CDP. */
  pageAddress(): Promise<string>;
  /** Opens a new tab on `url`, without connecting to it. */
  newTab(url: string): Promise<BrowserTarget>;
}

/** The tab choice's port over `client`, waiting on the clock. */
function cdpTabPort(client: TabClient): TabPort {
  return {
    listTargets: () => client.listTargets(),
    connect: (targetId) => client.connect(targetId),
    pageAddress: () => client.pageAddress(),
    newTab: (url) => client.newTab(url),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

/**
 * The tab choice over `client`. Each adapter builds one and passes it to
 * both `createCdpModeTool` and `createCdpAskCore`.
 */
export function createCdpPerplexityTab(client: TabClient): PerplexityTab {
  return new PerplexityTab(cdpTabPort(client));
}
