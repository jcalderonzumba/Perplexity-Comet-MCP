// The ask core's port, over the CDP client and the Comet module: the one
// `AskPort` both adapters build when they start, and the core built on it.
//
// Each method is one call to the client or the Comet module. The page is
// read only through the tested functions of `page-scripts.ts`, through the
// client's evaluate that reconnects when the connection drops. The prompt
// reaches the page only as the client's trusted text, which, like its keys,
// its clicks (the stop control's among them) and the focus emulation that
// lets them through, the client sends only to a tab on Perplexity's origin. Tabs are read and opened by
// the shared tab choice, `createCdpPerplexityTab`, never through this port.

import type { TrustedKey } from "./cdp-client.js";
import {
  AskCore,
  type AskPort,
  type AskStatus,
  PageScriptFailed,
} from "./core/ask.js";
import type { ModeTool } from "./core/mode-tool.js";
import type { BrowserTarget, PerplexityTab } from "./core/perplexity-tab.js";
import {
  locateStopControl,
  locateSubmitButton,
  type PagePoint,
  pageScriptExpression,
  readAskInput,
  readThreadState,
  selectAskInput,
  type ThreadState,
} from "./page-scripts.js";
import type { EvaluateResult } from "./types.js";

/** The part of the CDP client the ask drives. */
export interface AskPortClient {
  preOperationCheck(): Promise<unknown>;
  startComet(port: number): Promise<unknown>;
  listTargets(): Promise<readonly BrowserTarget[]>;
  connect(targetId: string): Promise<unknown>;
  ensureConnection(): Promise<unknown>;
  navigate(url: string, waitForLoad?: boolean): Promise<unknown>;
  /** Evaluates in the page, reconnecting when the connection has dropped. */
  safeEvaluate(expression: string): Promise<EvaluateResult>;
  /** Trusted text at the focused element; refused off Perplexity. */
  insertText(text: string): Promise<void>;
  /** A trusted key press; refused off Perplexity. */
  pressKey(key: TrustedKey): Promise<void>;
  /** A trusted click at a point; refused off Perplexity. */
  clickAt(point: PagePoint): Promise<void>;
  /** Makes the tab believe itself focused; refused off Perplexity. */
  startFocusEmulation(): Promise<void>;
  stopFocusEmulation(): Promise<void>;
}

/** The part of the Comet module the ask reads. */
export interface AskPortComet {
  getAgentStatus(): Promise<AskStatus>;
}

class CdpAskPort implements AskPort {
  constructor(
    private readonly client: AskPortClient,
    private readonly comet: AskPortComet,
  ) {}

  preOperationCheck(): Promise<unknown> {
    return this.client.preOperationCheck();
  }

  startComet(port: number): Promise<unknown> {
    return this.client.startComet(port);
  }

  listTargets(): Promise<readonly BrowserTarget[]> {
    return this.client.listTargets();
  }

  connect(targetId: string): Promise<unknown> {
    return this.client.connect(targetId);
  }

  ensureConnection(): Promise<unknown> {
    return this.client.ensureConnection();
  }

  navigate(url: string, waitForLoad: boolean): Promise<unknown> {
    return this.client.navigate(url, waitForLoad);
  }

  readThreadState(): Promise<ThreadState> {
    return this.runPageScript(readThreadState);
  }

  readStatus(): Promise<AskStatus> {
    return this.comet.getAgentStatus();
  }

  selectAskInput(): Promise<boolean> {
    return this.runPageScript(selectAskInput);
  }

  readAskInput(): Promise<string | null> {
    return this.runPageScript(readAskInput);
  }

  locateSubmitButton(): Promise<PagePoint | null> {
    return this.runPageScript(locateSubmitButton);
  }

  locateStopControl(): Promise<PagePoint | null> {
    return this.runPageScript(locateStopControl);
  }

  insertText(text: string): Promise<void> {
    return this.client.insertText(text);
  }

  pressEnter(): Promise<void> {
    return this.client.pressKey("Enter");
  }

  clickAt(point: PagePoint): Promise<void> {
    return this.client.clickAt(point);
  }

  startFocusEmulation(): Promise<void> {
    return this.client.startFocusEmulation();
  }

  stopFocusEmulation(): Promise<void> {
    return this.client.stopFocusEmulation();
  }

  now(): number {
    return Date.now();
  }

  wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async runPageScript<R>(script: () => R): Promise<R> {
    const response = await this.client.safeEvaluate(
      pageScriptExpression(script),
    );
    if (response.exceptionDetails) {
      const { exception, text } = response.exceptionDetails;
      throw new PageScriptFailed(script.name, exception?.description ?? text);
    }
    return response.result.value as R;
  }
}

/** The ask core's port over `client` and `comet`. */
export function cdpAskPort(
  client: AskPortClient,
  comet: AskPortComet,
): AskPort {
  return new CdpAskPort(client, comet);
}

export interface CdpAskCoreOptions {
  readonly client: AskPortClient;
  readonly comet: AskPortComet;
  /** The adapter's `comet_mode` tool, whose remembered mode the ask puts back. */
  readonly mode: Pick<ModeTool, "core" | "quotePage">;
  /** The tab choice that mode tool shares, from `createCdpPerplexityTab`. */
  readonly perplexity: PerplexityTab;
  /** The debug port Comet is started on when the connection is lost. */
  readonly cometPort: number;
}

/**
 * The ask core over the CDP client. Each adapter builds one when it starts,
 * with the mode tool its `comet_mode` uses, the tab choice they share, and
 * the configured debug port.
 */
export function createCdpAskCore(options: CdpAskCoreOptions): AskCore {
  return new AskCore({
    port: cdpAskPort(options.client, options.comet),
    mode: options.mode,
    perplexity: options.perplexity,
    cometPort: options.cometPort,
  });
}
