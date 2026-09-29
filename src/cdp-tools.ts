// The composition: the tool table over the CDP client, the Comet module and
// the UNTRUSTED wrapper. It is the one place a tool is bound to the browser;
// both adapters (`stdio-server.ts`, `bridge-server.ts`) list and dispatch
// through the table it builds and import nothing of the client.
//
// It builds what each adapter used to build by hand (the tab choice, the
// mode tool, the ask core, the connect core, the screenshot, tabs and upload
// ports) and binds each tool to its core.

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
import { createCdpTabsPort, type TabsClient } from "./cdp-tabs-port.js";
import { createCdpUploadPort, type UploadClient } from "./cdp-upload-port.js";
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
import { answerTabs } from "./core/tabs.js";
import { createToolTable, type ToolTable } from "./core/tools.js";
import { answerUpload } from "./core/upload.js";
import { wrapUntrustedPageContent } from "./untrusted.js";

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
  const tabs = {
    port: createCdpTabsPort(client),
    record: perplexity,
    quotePage,
  };
  const upload = { port: createCdpUploadPort(client), quotePage };
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
      comet_tabs: (args) => answerTabs(args, tabs),
      comet_mode: (args) => answerModeTool(args.mode, modeTool),
      comet_upload: (args) => answerUpload(args, upload),
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
