// The composition: the tool table over the CDP client, the Comet module and
// the UNTRUSTED wrapper. It is the one place a tool is bound to the browser;
// both adapters (`stdio-server.ts`, `bridge-server.ts`) list and dispatch
// through the table it builds and import nothing of the client.
//
// It builds what each adapter used to build by hand (the tab choice, the
// mode tool, the ask core, the connect core, the screenshot port) and holds
// the handlers of the tools that have no core yet: tabs and upload, as the
// stdio server answered them. Phase 3 of the core extraction replaces them
// with cores.

import type { AskPortClient, AskPortComet } from "./cdp-ask-port.js";
import { createCdpAskCore } from "./cdp-ask-port.js";
import {
  type CometCDPClient,
  cometClient,
  DEFAULT_PORT,
} from "./cdp-client.js";
import { createCdpModeTool, type ModePageClient } from "./cdp-mode-page.js";
import {
  createCdpPerplexityTab,
  type TabClient,
} from "./cdp-perplexity-tab.js";
import { cometAI } from "./comet-ai.js";
import { systemCometLaunch } from "./comet-launch.js";
import {
  describeAskOutcome,
  describePollOutcome,
  describeStopOutcome,
} from "./core/ask-reply.js";
import type { CometLaunch } from "./core/comet-launch.js";
import { answerConnect } from "./core/connect.js";
import { answerModeTool } from "./core/mode-tool.js";
import { answerScreenshot } from "./core/screenshot.js";
import { errorReply, type ToolReply, textReply } from "./core/tool-reply.js";
import {
  createToolTable,
  type ToolHandler,
  type ToolTable,
} from "./core/tools.js";
import { wrapUntrustedPageContent } from "./untrusted.js";
import {
  validateDomain,
  validateSelector,
  validateTabId,
  validateUploadPath,
} from "./upload-validator.js";

type TabsClient = Pick<
  CometCDPClient,
  | "getTabSummary"
  | "connect"
  | "findTabByDomain"
  | "getTabContexts"
  | "closeTab"
>;

type UploadClient = Pick<CometCDPClient, "hasFileInput" | "uploadFile">;

/** Everything the composition drives on the CDP client. */
export type CdpToolsClient = AskPortClient &
  ModePageClient &
  TabClient &
  TabsClient &
  UploadClient &
  Pick<CometCDPClient, "screenshot" | "disconnect">;

export interface CdpToolsDeps {
  readonly client: CdpToolsClient;
  readonly comet: AskPortComet;
  /** How Comet is found and launched: the one launch, which never kills. */
  readonly launch: CometLaunch;
  /** The UNTRUSTED wrapper: the only way page text reaches a reply. */
  readonly quotePage: (pageText: string) => string;
  /** The debug port Comet is started on, from the environment. */
  readonly port: number;
}

/** The tool table over `deps`. */
export function createCdpToolTable(deps: CdpToolsDeps): ToolTable {
  const { client, comet, launch, quotePage, port } = deps;
  // The tab choice comet_ask and comet_mode share, and with it the one
  // record of the tabs the server opened, whichever of them opened a tab.
  const perplexity = createCdpPerplexityTab(client);
  const modeTool = createCdpModeTool(client, quotePage, perplexity);
  // The ask core, and the task comet_poll and comet_stop follow, for as long
  // as the server runs. It puts back the mode comet_mode last set.
  const askCore = createCdpAskCore({
    client,
    comet,
    launch,
    mode: modeTool,
    perplexity,
    cometPort: port,
  });

  return createToolTable(
    {
      comet_connect: () => answerConnect({ launch, port, tabs: perplexity }),
      comet_ask: async (args) =>
        describeAskOutcome(await askCore.ask(args), quotePage),
      comet_poll: async () =>
        describePollOutcome(await askCore.poll(), quotePage),
      comet_stop: async () => describeStopOutcome(await askCore.stop()),
      comet_screenshot: () =>
        answerScreenshot({
          capturePng: async () => (await client.screenshot("png")).data,
        }),
      comet_tabs: tabsHandler(client),
      comet_mode: (args) => answerModeTool(args.mode, modeTool),
      comet_upload: uploadHandler(client),
    },
    quotePage,
  );
}

/** The real tool table and the way to close what it drives. */
export interface CdpTools {
  readonly table: ToolTable;
  /** Closes the CDP connection; the adapters call it when they shut down. */
  disconnect(): Promise<void>;
}

/** The tool table over the server's own client and Comet module. */
export function createCdpTools(): CdpTools {
  return {
    table: createCdpToolTable({
      client: cometClient,
      comet: cometAI,
      launch: systemCometLaunch,
      quotePage: wrapUntrustedPageContent,
      port: DEFAULT_PORT,
    }),
    disconnect: () => cometClient.disconnect(),
  };
}

// ============================================================================
// comet_tabs
// ============================================================================

function tabsHandler(client: TabsClient): ToolHandler {
  return async (args) => {
    const action = (args.action as string) || "list";
    const domain = args.domain as string | undefined;
    const tabId = args.tabId as string | undefined;

    switch (action) {
      case "list":
        return textReply(await client.getTabSummary());
      case "switch":
        return switchTab(client, tabId, domain);
      case "close":
        return closeTab(client, tabId, domain);
      default:
        return errorReply(
          `Unknown action: ${action}. Use: list, switch, close`,
        );
    }
  };
}

const NO_TAB_FOR_DOMAIN = "No tab found for the specified domain";

async function switchTab(
  client: TabsClient,
  tabId: string | undefined,
  domain: string | undefined,
): Promise<ToolReply> {
  if (tabId) {
    validateTabId(tabId);
    await client.connect(tabId);
    return textReply(`Switched to tab: ${tabId}`);
  }
  if (domain) {
    validateDomain(domain);
    const tab = await client.findTabByDomain(domain);
    if (!tab) return errorReply(NO_TAB_FOR_DOMAIN);
    await client.connect(tab.id);
    return textReply(`Switched to ${tab.domain} (${tab.url})`);
  }
  return errorReply("Specify domain or tabId to switch");
}

async function closeTab(
  client: TabsClient,
  tabId: string | undefined,
  domain: string | undefined,
): Promise<ToolReply> {
  // Safety check: don't close if it would leave no browsing tabs. The list
  // holds only external tabs (Perplexity is filtered as internal).
  if ((await client.getTabContexts()).length <= 1) {
    return errorReply(
      "Cannot close - this is the only browsing tab. Comet needs at least one external tab open.",
    );
  }
  if (tabId) {
    validateTabId(tabId);
    const closed = await client.closeTab(tabId);
    return textReply(closed ? `Closed tab: ${tabId}` : "Failed to close tab");
  }
  if (domain) {
    validateDomain(domain);
    const tab = await client.findTabByDomain(domain);
    if (!tab) return errorReply(NO_TAB_FOR_DOMAIN);
    if (tab.purpose === "main") {
      return errorReply("Cannot close main Perplexity tab");
    }
    const closed = await client.closeTab(tab.id);
    return textReply(closed ? `Closed ${tab.domain}` : "Failed to close tab");
  }
  return errorReply("Specify domain or tabId to close");
}

// ============================================================================
// comet_upload
// ============================================================================

function uploadHandler(client: UploadClient): ToolHandler {
  return async (args) => {
    const filePath = args.filePath as string;
    const selector = args.selector as string | undefined;
    const checkOnly = args.checkOnly as boolean | undefined;

    if (!filePath) return errorReply("Error: filePath is required");

    // Validate path: enforce COMET_UPLOAD_ROOT allowlist if set, else block
    // well-known secret locations. Resolves symlinks. Throws a user-facing
    // message on rejection, which the table words as an error reply.
    const resolvedPath = validateUploadPath(filePath);

    // Defense-in-depth: validate the selector at the tool-handler boundary
    // before it reaches cdp-client.ts (which also validates).
    if (selector !== undefined) validateSelector(selector);

    if (checkOnly) return describeFileInputs(client);

    const result = await client.uploadFile(resolvedPath, selector);
    if (result.success) return textReply(result.message);
    return errorReply(
      result.inputFound
        ? result.message
        : await withAvailableInputs(client, result.message),
    );
  };
}

async function describeFileInputs(client: UploadClient): Promise<ToolReply> {
  const inputInfo = await client.hasFileInput();
  if (!inputInfo.found) {
    return textReply(
      "No file input elements found on the current page. Navigate to a page with a file upload form first.",
    );
  }
  return textReply(
    `Found ${inputInfo.count} file input(s) on the page:\n${numbered(inputInfo.selectors)}\n\nUse comet_upload with filePath to upload to one of these inputs.`,
  );
}

/** A failed upload's message, with the page's file inputs when it has any. */
async function withAvailableInputs(
  client: UploadClient,
  message: string,
): Promise<string> {
  const inputInfo = await client.hasFileInput();
  if (!inputInfo.found) return message;
  return `${message}\n\nAvailable file inputs:\n${numbered(inputInfo.selectors)}\n\nTry specifying a selector parameter.`;
}

function numbered(selectors: readonly string[]): string {
  return selectors.map((s, i) => `  ${i + 1}. ${s}`).join("\n");
}
