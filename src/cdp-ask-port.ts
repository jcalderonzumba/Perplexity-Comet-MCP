// The ask core's port, over the CDP client and the Comet module: the one
// `AskPort` both adapters build when they start, and the core built on it.
//
// Each method is one call to the client or the Comet module. The page is
// read only through the tested functions of `page-scripts.ts`, through the
// client's evaluate that reconnects when the connection drops. The prompt
// reaches the page only as the client's trusted text, which, like its keys
// and clicks, the client sends only to a tab on Perplexity's origin.

import type { TrustedKey } from "./cdp-client.js";
import {
  AskCore,
  type AskPort,
  type AskStatus,
  type AskTarget,
  PageScriptFailed,
} from "./core/ask.js";
import type { ModeTool } from "./core/mode-tool.js";
import {
  locateSubmitButton,
  type PagePoint,
  type ProseState,
  pageScriptExpression,
  readAskInput,
  readPageAddress,
  readProseState,
  selectAskInput,
} from "./page-scripts.js";
import type { EvaluateResult } from "./types.js";

/** The part of the CDP client the ask drives. */
export interface AskPortClient {
  preOperationCheck(): Promise<unknown>;
  startComet(port: number): Promise<unknown>;
  listTargets(): Promise<readonly AskTarget[]>;
  connect(targetId: string): Promise<unknown>;
  ensureConnection(): Promise<unknown>;
  navigate(url: string, waitForLoad?: boolean): Promise<unknown>;
  listTabsCategorized(): Promise<{ main: AskTarget | null }>;
  /** Evaluates in the page, reconnecting when the connection has dropped. */
  safeEvaluate(expression: string): Promise<EvaluateResult>;
  isOnPerplexityTab(): Promise<boolean>;
  ensureOnPerplexityTab(): Promise<boolean>;
  /** Trusted text at the focused element; refused off Perplexity. */
  insertText(text: string): Promise<void>;
  /** A trusted key press; refused off Perplexity. */
  pressKey(key: TrustedKey): Promise<void>;
  /** A trusted click at a point; refused off Perplexity. */
  clickAt(point: PagePoint): Promise<void>;
}

/** The part of the Comet module the ask drives. */
export interface AskPortComet {
  getAgentStatus(): Promise<AskStatus>;
  resetStabilityTracking(): void;
  stopAgent(): Promise<boolean>;
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

  listTargets(): Promise<readonly AskTarget[]> {
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

  async mainTab(): Promise<AskTarget | null> {
    return (await this.client.listTabsCategorized()).main;
  }

  currentUrl(): Promise<string> {
    return this.runPageScript(readPageAddress);
  }

  isOnPerplexityTab(): Promise<boolean> {
    return this.client.isOnPerplexityTab();
  }

  ensureOnPerplexityTab(): Promise<boolean> {
    return this.client.ensureOnPerplexityTab();
  }

  readProseState(): Promise<ProseState> {
    return this.runPageScript(readProseState);
  }

  readStatus(): Promise<AskStatus> {
    return this.comet.getAgentStatus();
  }

  resetStabilityTracking(): void {
    this.comet.resetStabilityTracking();
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

  insertText(text: string): Promise<void> {
    return this.client.insertText(text);
  }

  pressEnter(): Promise<void> {
    return this.client.pressKey("Enter");
  }

  clickAt(point: PagePoint): Promise<void> {
    return this.client.clickAt(point);
  }

  stopAgent(): Promise<boolean> {
    return this.comet.stopAgent();
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
  /** The debug port Comet is started on when the connection is lost. */
  readonly cometPort: number;
}

/**
 * The ask core over the CDP client. Each adapter builds one when it starts,
 * with the mode tool its `comet_mode` uses and the configured debug port.
 */
export function createCdpAskCore(options: CdpAskCoreOptions): AskCore {
  return new AskCore({
    port: cdpAskPort(options.client, options.comet),
    mode: options.mode,
    cometPort: options.cometPort,
  });
}
