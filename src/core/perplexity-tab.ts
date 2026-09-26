// The tab an ask is typed in and a mode is switched in: Perplexity's main
// page, as `isPerplexityMainPage` alone decides, never the sidecar and never
// a user's page.
//
// The connected tab's address is read from the browser through the port,
// never from page script. When the connected tab is not the main page, the
// connection moves to a main page already open; when none is, a new tab is
// opened on Perplexity's home page, and remembered as opened by the server.
// The port can list, connect and open, and nothing else: no tab is ever
// navigated or closed here, so a page the user was reading stays as it was.

import { isPerplexityMainPage, PERPLEXITY_HOME } from "../perplexity-pages.js";

/** A browser target, as the CDP client lists it. */
export interface BrowserTarget {
  readonly id: string;
  readonly type: string;
  readonly url: string;
}

/** What the tab choice needs from the browser. */
export interface TabPort {
  listTargets(): Promise<readonly BrowserTarget[]>;
  connect(targetId: string): Promise<unknown>;
  /** The connected tab's address, as the browser reports its top frame. */
  pageAddress(): Promise<string>;
  /** Opens a new tab on `url`, without connecting to it. */
  newTab(url: string): Promise<BrowserTarget>;
  wait(ms: number): Promise<void>;
}

/** How the connection reached Perplexity's main page. */
export type TabMove = "stayed" | "moved" | "opened";

/** The tab choice's waits, in milliseconds. */
export const TAB_TIMING = {
  /** After opening Perplexity's home page in a new tab. */
  openedSettleMs: 2000,
} as const;

/** Keeps the connection on Perplexity's main page. */
export class PerplexityTab {
  private readonly openedIds = new Set<string>();

  constructor(private readonly port: TabPort) {}

  /** Whether the server opened the tab `targetId`. */
  opened(targetId: string): boolean {
    return this.openedIds.has(targetId);
  }

  /** Whether the connected tab is the main page; false when unreadable. */
  async connectedToMainPage(): Promise<boolean> {
    try {
      return isPerplexityMainPage(await this.port.pageAddress());
    } catch {
      return false;
    }
  }

  /**
   * Keeps the connection on a main page already open, moving it there when
   * it is elsewhere; false when none is open or the tabs cannot be read.
   * Never opens a tab.
   */
  async returnToMainPage(): Promise<boolean> {
    if (await this.connectedToMainPage()) return true;
    try {
      return await this.connectToOpenMainPage();
    } catch {
      return false;
    }
  }

  /** The connection on a main page: the one it is on, another, or a new one. */
  async bringToMainPage(): Promise<TabMove> {
    if (await this.connectedToMainPage()) return "stayed";
    return this.reconnectToMainPage();
  }

  /**
   * Connects to a main page already open, even the one the connection is on,
   * as after a failure; opens one when none is.
   */
  async reconnectToMainPage(): Promise<TabMove> {
    if (await this.connectToOpenMainPage()) return "moved";
    await this.openMainPage();
    return "opened";
  }

  private async connectToOpenMainPage(): Promise<boolean> {
    const main = (await this.port.listTargets()).find(isMainPageTarget);
    if (!main) return false;
    await this.port.connect(main.id);
    return true;
  }

  private async openMainPage(): Promise<void> {
    const tab = await this.port.newTab(PERPLEXITY_HOME);
    this.openedIds.add(tab.id);
    await this.port.connect(tab.id);
    await this.port.wait(TAB_TIMING.openedSettleMs);
  }
}

/** Whether `target` is a page on Perplexity's main page. */
export function isMainPageTarget(target: BrowserTarget): boolean {
  return target.type === "page" && isPerplexityMainPage(target.url);
}
