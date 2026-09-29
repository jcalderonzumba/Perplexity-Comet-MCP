// The `comet_tabs` port over the CDP client: the browser's targets, the tab
// the connection is on, a connect and a close.

import type { BrowserTarget } from "./core/perplexity-tab.js";
import type { TabsPort } from "./core/tabs.js";

/** The part of the CDP client `comet_tabs` drives. */
export interface TabsClient {
  listTargets(): Promise<readonly BrowserTarget[]>;
  connectedTabId(): string | null;
  connect(targetId: string): Promise<unknown>;
  closeTab(targetId: string): Promise<boolean>;
}

/** The tabs port over `client`. */
export function createCdpTabsPort(client: TabsClient): TabsPort {
  return {
    listTargets: () => client.listTargets(),
    connectedTabId: () => client.connectedTabId(),
    connect: (targetId) => client.connect(targetId),
    close: (targetId) => client.closeTab(targetId),
  };
}
