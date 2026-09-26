// The ask's connection and its tab: the connection checked, and recovered by
// starting Comet when it is lost; then the connection brought to Perplexity's
// main page the prompt is typed in, by `PerplexityTab`'s rule, never the
// sidecar and never a user's page.
//
// A new chat opens Perplexity's home page in the main tab, or in the new tab
// the tab choice opened on it. A follow-up asks in the main tab as it is.
// No tab other than Perplexity's main page is ever navigated.

import { PERPLEXITY_HOME } from "../perplexity-pages.js";
import {
  type BrowserTarget,
  isMainPageTarget,
  type PerplexityTab,
  type TabPort,
} from "./perplexity-tab.js";

/**
 * What the ask's connection and tab need from the browser. The tab choice it
 * is given reads and opens tabs through its own port, so this one only lists
 * and connects them, for the recovery, and waits.
 */
export interface AskTabPort
  extends Pick<TabPort, "listTargets" | "connect" | "wait"> {
  /** Checks the connection is alive; throws when it is not. */
  preOperationCheck(): Promise<unknown>;
  /** Starts Comet with its debug port on `port`, or finds it running. */
  startComet(port: number): Promise<unknown>;
  ensureConnection(): Promise<unknown>;
  navigate(url: string, waitForLoad: boolean): Promise<unknown>;
}

/** The ask tab's waits, in milliseconds. */
export const ASK_TAB_TIMING = {
  /** After opening Perplexity's home page for a new chat. */
  newChatSettleMs: 2000,
  /** After reconnecting to the main page when that navigation failed. */
  fallbackSettleMs: 1500,
} as const;

/** The connection an ask runs on, and the tab it asks in. */
export class AskTab {
  constructor(
    private readonly port: AskTabPort,
    /** The debug port Comet is started on when the connection is lost. */
    private readonly cometPort: number,
    /**
     * The tab choice, which remembers the tabs it opened; the adapter's
     * `comet_mode` shares it, so the record holds the tabs either opened.
     */
    readonly perplexity: PerplexityTab,
  ) {}

  /** True when connected, after starting Comet again if the check failed. */
  async connectOrRecover(): Promise<boolean> {
    try {
      await this.port.preOperationCheck();
      return true;
    } catch {
      // The connection is gone: start Comet, or find it, and reconnect.
    }
    try {
      await this.port.startComet(this.cometPort);
      const page = recoveryPage(await this.port.listTargets());
      if (page) await this.port.connect(page.id);
      return true;
    } catch {
      return false;
    }
  }

  /** The connection on the main page, on its home page for a new chat. */
  async bringToAskPage(newChat: boolean): Promise<void> {
    if (newChat) await this.openNewChat();
    else await this.perplexity.bringToMainPage();
  }

  /** `PerplexityTab.returnToMainPage`, for the reads of an answer. */
  returnToMainPage(): Promise<boolean> {
    return this.perplexity.returnToMainPage();
  }

  private async openNewChat(): Promise<void> {
    await this.port.ensureConnection();
    if ((await this.perplexity.bringToMainPage()) === "opened") return;
    try {
      await this.port.navigate(PERPLEXITY_HOME, true);
      await this.port.wait(ASK_TAB_TIMING.newChatSettleMs);
    } catch {
      await this.perplexity.reconnectToMainPage();
      await this.port.wait(ASK_TAB_TIMING.fallbackSettleMs);
    }
  }
}

/** The tab to reconnect to after starting Comet: its main page, or any page. */
function recoveryPage(
  targets: readonly BrowserTarget[],
): BrowserTarget | undefined {
  return (
    targets.find(isMainPageTarget) ??
    targets.find((target) => target.type === "page")
  );
}
