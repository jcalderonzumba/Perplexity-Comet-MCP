/**
 * `comet_tabs`' replies as the tabs core words them, for the battery
 * predicates' tests: each is the core answering over a fake browser, through
 * the real UNTRUSTED wrapper, so a predicate is tested against the server's
 * own words and not against text a test invented.
 */
import { answerTabs } from "../../../src/core/tabs.js";
import { toStdioResult } from "../../../src/tool-results.js";
import { wrapUntrustedPageContent } from "../../../src/untrusted.js";
import type { ToolReply } from "../../lib/no-pro-checks.mjs";
import { FakeTabsPort, recordOf } from "../../unit/fakes/fake-tabs-port.js";

/** A page open in the browser; `openedByServer` puts it in the server's record. */
export interface OpenPage {
  readonly url: string;
  readonly openedByServer?: boolean;
}

/** Another page, so no tab of the reply's is the last page or the connected one. */
const ANOTHER_PAGE: OpenPage = { url: "https://elsewhere.example/" };

const idOf = (index: number) => `tab-${index}`;

/** The browser with `pages` open and the connection on the last of them. */
function browserWith(pages: readonly OpenPage[]) {
  const port = new FakeTabsPort(
    ...pages.map((page, index) => ({
      id: idOf(index),
      type: "page",
      url: page.url,
    })),
  );
  port.connected = idOf(pages.length - 1);
  const opened = pages.flatMap((page, index) =>
    page.openedByServer ? [idOf(index)] : [],
  );
  return { port, opened };
}

async function reply(
  pages: readonly OpenPage[],
  args: Record<string, unknown>,
): Promise<ToolReply> {
  const { port, opened } = browserWith(pages);
  return toStdioResult(
    await answerTabs(args, {
      port,
      record: recordOf(...opened),
      quotePage: wrapUntrustedPageContent,
    }),
  );
}

/** `comet_tabs`' listing with these pages open. */
export function tabListing(...pages: Array<OpenPage | string>) {
  return reply(pages.map(asPage), {});
}

/** The reply to `switch` to the tab on `domain`, the page at `url`. */
export function switchReply(domain: string, url: string) {
  return reply([{ url }, ANOTHER_PAGE], { action: "switch", domain });
}

/** The reply to `close` of the tab on `domain`, the page at `url`. */
export function closeReply(domain: string, page: OpenPage) {
  return reply([page, ANOTHER_PAGE], { action: "close", domain });
}

function asPage(page: OpenPage | string): OpenPage {
  return typeof page === "string" ? { url: page } : page;
}
