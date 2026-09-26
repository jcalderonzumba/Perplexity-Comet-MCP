// The mode core's page, over the CDP client: the one `ModePage` both
// adapters build when they start, the navigation to Perplexity the
// `comet_mode` tool makes before a switch, and the tool built from them.
//
// Clicks and Escape are trusted input, clicks at points a page script
// returns. The client sends them only while the browser reports the tab's
// top frame on Perplexity's own origin, so a page elsewhere, imitating the
// mode button or an open menu, never steers them.

import { PERPLEXITY_ORIGIN, type TrustedKey } from "./cdp-client.js";
import { ModeCore, type ModePage } from "./core/mode.js";
import type { ModeTool } from "./core/mode-tool.js";
import {
  type PageArgument,
  type PagePoint,
  pageScriptExpression,
} from "./page-scripts.js";
import type { EvaluateResult } from "./types.js";

const PERPLEXITY_HOME = `${PERPLEXITY_ORIGIN}/`;

/** The part of the CDP client that reads the tab's origin from the browser. */
export interface OriginReader {
  /** The top frame's security origin, as the browser reports it now. */
  pageOrigin(): Promise<string>;
}

/**
 * The part of the CDP client the mode page drives. Its clicks and key
 * presses are refused off Perplexity's origin.
 */
export interface ModePageClient {
  evaluate(expression: string): Promise<EvaluateResult>;
  clickAt(point: PagePoint): Promise<void>;
  pressKey(key: TrustedKey): Promise<void>;
}

/** The part of the CDP client that knows and changes the tab's address. */
export interface PerplexityNavigator extends OriginReader {
  navigate(url: string, waitForLoad?: boolean): Promise<unknown>;
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

/** Opens Perplexity's home page, waiting for it to load, unless the tab is there. */
export async function openPerplexityIfElsewhere(
  client: PerplexityNavigator,
): Promise<void> {
  if ((await client.pageOrigin()) === PERPLEXITY_ORIGIN) return;
  await client.navigate(PERPLEXITY_HOME, true);
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
  client: ModePageClient & PerplexityNavigator,
  quotePage: (pageText: string) => string,
): ModeTool {
  return {
    core: new ModeCore(cdpModePage(client)),
    openPerplexity: () => openPerplexityIfElsewhere(client),
    quotePage,
  };
}
