// The mode core's page, over the CDP client: the one `ModePage` both
// adapters build when they start, the move to Perplexity's main page the
// `comet_mode` tool makes before a switch, and the tool built from them.
//
// The move is the ask's own tab choice, `PerplexityTab`: the connection goes
// to Perplexity's main page as its one rule decides, never to the sidecar or
// a user's page, and a new tab is opened on Perplexity's home page when no
// main page is open. No tab is navigated.
//
// Clicks and Escape are trusted input, clicks at points a page script
// returns. The client sends them only while the browser reports the tab's
// top frame on Perplexity's own origin, so a page elsewhere, imitating the
// mode button or an open menu, never steers them.

import type { TrustedKey } from "./cdp-client.js";
import { ModeCore, type ModePage } from "./core/mode.js";
import type { ModeTool } from "./core/mode-tool.js";
import {
  type BrowserTarget,
  PerplexityTab,
  type TabPort,
} from "./core/perplexity-tab.js";
import {
  type PageArgument,
  type PagePoint,
  pageScriptExpression,
} from "./page-scripts.js";
import type { EvaluateResult } from "./types.js";

/**
 * The part of the CDP client the mode page drives. Its clicks and key
 * presses are refused off Perplexity's origin.
 */
export interface ModePageClient {
  evaluate(expression: string): Promise<EvaluateResult>;
  clickAt(point: PagePoint): Promise<void>;
  pressKey(key: TrustedKey): Promise<void>;
}

/** The part of the CDP client the move to Perplexity's main page drives. */
export interface ModeTabClient {
  listTargets(): Promise<readonly BrowserTarget[]>;
  connect(targetId: string): Promise<unknown>;
  /** The connected tab's top-frame address, read through CDP. */
  pageAddress(): Promise<string>;
  /** Opens a new tab on `url`, without connecting to it. */
  newTab(url: string): Promise<BrowserTarget>;
}

class CdpModePage implements ModePage {
  constructor(private readonly client: ModePageClient) {}

  async run<A extends PageArgument[], R>(
    script: (...args: A) => R,
    ...args: A
  ): Promise<R> {
    const response = await this.client.evaluate(
      pageScriptExpression(script, ...args),
    );
    if (response.exceptionDetails) {
      throw new Error(
        `${script.name} failed in the page: ${errorDetail(response.exceptionDetails)}`,
      );
    }
    return response.result.value as R;
  }

  clickAt(point: PagePoint): Promise<void> {
    return this.client.clickAt(point);
  }

  pressEscape(): Promise<void> {
    return this.client.pressKey("Escape");
  }

  wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** The mode core's page port over `client`. */
export function cdpModePage(client: ModePageClient): ModePage {
  return new CdpModePage(client);
}

/** The tab choice's port over `client`. */
function cdpTabPort(client: ModeTabClient): TabPort {
  return {
    listTargets: () => client.listTargets(),
    connect: (targetId) => client.connect(targetId),
    pageAddress: () => client.pageAddress(),
    newTab: (url) => client.newTab(url),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

function errorDetail(
  details: NonNullable<EvaluateResult["exceptionDetails"]>,
): string {
  return details.exception?.description ?? details.text;
}

/**
 * The `comet_mode` tool over `client`, with a mode core of its own. Each
 * adapter builds one when it starts, passing its UNTRUSTED wrapper.
 */
export function createCdpModeTool(
  client: ModePageClient & ModeTabClient,
  quotePage: (pageText: string) => string,
): ModeTool {
  const tab = new PerplexityTab(cdpTabPort(client));
  return {
    core: new ModeCore(cdpModePage(client)),
    openPerplexity: async () => {
      await tab.bringToMainPage();
    },
    quotePage,
  };
}
