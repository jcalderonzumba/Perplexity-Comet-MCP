// The `comet_tabs` tool: list the tabs, switch the connection to one, close
// one.
//
// Which tabs are browsing tabs, each one's domain and purpose, and the
// domain match are decided here over the targets the browser lists; the port
// only lists, connects and closes.
//
// Principle 6: the server closes only a tab it opened. CDP cannot tell the
// agent's tabs from the user's, so `PerplexityTab`'s record of the tabs it
// opened decides (D28): `close` refuses every other tab, the last page tab
// and the tab the connection is on, which the ask and the mode work in.
// Principle 1: a tab's address and domain are text the page chose, so they
// reach a reply only through the UNTRUSTED wrapper.

import { errorMessage } from "../error-message.js";
import { isPerplexitySite } from "../perplexity-pages.js";
import { validateDomain, validateTabId } from "../upload-validator.js";
import type { BrowserTarget } from "./perplexity-tab.js";
import { errorReply, type ToolReply, textReply } from "./tool-reply.js";

/** What `comet_tabs` needs from the browser. */
export interface TabsPort {
  listTargets(): Promise<readonly BrowserTarget[]>;
  /** The tab the connection is on; null when it is on none. */
  connectedTabId(): string | null;
  connect(targetId: string): Promise<unknown>;
  /** Closes a tab; false when the browser did not. */
  close(targetId: string): Promise<boolean>;
}

/** The record of the tabs the server opened (`PerplexityTab`'s). */
export interface OpenedTabs {
  opened(targetId: string): boolean;
}

export interface TabsDeps {
  readonly port: TabsPort;
  readonly record: OpenedTabs;
  /** The UNTRUSTED wrapper: the only way page text reaches a reply. */
  readonly quotePage: (pageText: string) => string;
}

/** A tab as `comet_tabs` shows and matches it. */
interface Tab {
  readonly id: string;
  readonly url: string;
  readonly domain: string;
  readonly purpose: "MAIN" | "AGENT-BROWSING";
  readonly openedByServer: boolean;
}

/** Answers `comet_tabs`. */
export async function answerTabs(
  args: Record<string, unknown>,
  deps: TabsDeps,
): Promise<ToolReply> {
  const action = text(args.action) || "list";
  const choice = { tabId: text(args.tabId), domain: text(args.domain) };
  switch (action) {
    case "list":
      return listTabs(deps);
    case "switch":
      return switchTab(deps, choice);
    case "close":
      return closeTab(deps, choice);
    default:
      return errorReply(`Unknown action: ${action}. Use: list, switch, close`);
  }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// ============================================================================
// Which tabs there are
// ============================================================================

/**
 * Whether `target` is a browsing tab: a page that is not one of Chrome's or
 * Comet's own (`chrome://`, an extension, DevTools, a blank page) and not
 * Perplexity's, which is Comet's interface.
 */
export function isBrowsingTab(target: BrowserTarget): boolean {
  return (
    target.type === "page" &&
    !isInternalAddress(target.url) &&
    !isPerplexitySite(target.url)
  );
}

function isInternalAddress(address: string): boolean {
  return (
    address === "" ||
    address === "about:blank" ||
    address.startsWith("chrome://") ||
    address.startsWith("chrome-extension://") ||
    address.startsWith("devtools://")
  );
}

function pageTargets(targets: readonly BrowserTarget[]): BrowserTarget[] {
  return targets.filter((target) => target.type === "page");
}

function tabOf(target: BrowserTarget, record: OpenedTabs): Tab {
  return {
    id: target.id,
    url: target.url,
    domain: domainOf(target.url),
    purpose: isPerplexitySite(target.url) ? "MAIN" : "AGENT-BROWSING",
    openedByServer: record.opened(target.id),
  };
}

function domainOf(address: string): string {
  try {
    return new URL(address).hostname;
  } catch {
    return "unknown";
  }
}

/** The tabs `list` shows: the browsing tabs, and every tab the server opened. */
function shownTabs(
  targets: readonly BrowserTarget[],
  record: OpenedTabs,
): Tab[] {
  return pageTargets(targets)
    .filter((target) => isBrowsingTab(target) || record.opened(target.id))
    .map((target) => tabOf(target, record));
}

/**
 * The first shown tab on `domain` or a subdomain of it: `github.com`
 * matches `gist.github.com` and not `notgithub.com`.
 */
function tabOnDomain(tabs: readonly Tab[], domain: string): Tab | undefined {
  const wanted = domain.toLowerCase();
  return tabs.find((tab) => {
    const own = tab.domain.toLowerCase();
    return own === wanted || own.endsWith(`.${wanted}`);
  });
}

// ============================================================================
// list
// ============================================================================

const ADDRESS_SHOWN = 80;

async function listTabs({ port, record, quotePage }: TabsDeps) {
  const tabs = shownTabs(await port.listTargets(), record);
  if (tabs.length === 0) return textReply("No browsing tabs open");
  const active = port.connectedTabId();
  const lines = tabs.flatMap((tab) => tabLines(tab, tab.id === active));
  return textReply(
    `${tabs.length} tab(s) open:\n${quotePage(lines.join("\n"))}`,
  );
}

function tabLines(tab: Tab, active: boolean): string[] {
  const marks =
    (active ? " [ACTIVE]" : "") +
    (tab.openedByServer ? " [OPENED BY SERVER]" : "");
  const address =
    tab.url.length > ADDRESS_SHOWN
      ? `${tab.url.slice(0, ADDRESS_SHOWN)}...`
      : tab.url;
  return [`  • ${tab.purpose}: ${tab.domain}${marks}`, `    URL: ${address}`];
}

// ============================================================================
// Choosing a tab: switch and close
// ============================================================================

interface TabChoice {
  readonly tabId: string | undefined;
  readonly domain: string | undefined;
}

/** A page's identity as a reply names it, wrapped: it is text the page chose. */
function named(tab: Tab, quotePage: (pageText: string) => string): string {
  return quotePage(`${tab.domain} (${tab.url})`);
}

/**
 * The tab the caller chose, after validating what they gave: by id among the
 * browser's page targets, by domain among the tabs `list` shows. A reply
 * when the choice is invalid, absent or matches no tab.
 */
async function chosenTab(
  { port, record }: TabsDeps,
  choice: TabChoice,
  action: string,
): Promise<{ tab: Tab; pages: number } | ToolReply> {
  const invalid = invalidChoice(choice, action);
  if (invalid) return invalid;

  const pages = pageTargets(await port.listTargets());
  const tab = choice.tabId
    ? tabWithId(pages, record, choice.tabId)
    : tabOnDomain(shownTabs(pages, record), choice.domain as string);
  if (!tab) return errorReply(noTabFor(choice));
  return { tab, pages: pages.length };
}

/** A reply when the choice is absent or invalid, before any port call. */
function invalidChoice(
  { tabId, domain }: TabChoice,
  action: string,
): ToolReply | null {
  if (tabId) return refusal(validateTabId, tabId);
  if (domain) return refusal(validateDomain, domain);
  return errorReply(`Specify domain or tabId to ${action}`);
}

function tabWithId(
  pages: readonly BrowserTarget[],
  record: OpenedTabs,
  tabId: string,
): Tab | undefined {
  const page = pages.find((target) => target.id === tabId);
  return page && tabOf(page, record);
}

function noTabFor({ tabId }: TabChoice): string {
  return tabId
    ? `No open page tab has the id ${tabId}`
    : "No tab found for the specified domain";
}

/** The error reply for what `check` throws on `value`; null when it holds. */
function refusal(
  check: (value: string) => unknown,
  value: string,
): ToolReply | null {
  try {
    check(value);
    return null;
  } catch (error) {
    return errorReply(`Error: ${errorMessage(error)}`);
  }
}

function isReply(chosen: { tab: Tab } | ToolReply): chosen is ToolReply {
  return "kind" in chosen;
}

// ============================================================================
// switch
// ============================================================================

async function switchTab(
  deps: TabsDeps,
  choice: TabChoice,
): Promise<ToolReply> {
  const chosen = await chosenTab(deps, choice, "switch");
  if (isReply(chosen)) return chosen;
  await deps.port.connect(chosen.tab.id);
  return textReply(
    `Switched to tab: ${chosen.tab.id}\n${named(chosen.tab, deps.quotePage)}`,
  );
}

// ============================================================================
// close
// ============================================================================

async function closeTab(deps: TabsDeps, choice: TabChoice): Promise<ToolReply> {
  const chosen = await chosenTab(deps, choice, "close");
  if (isReply(chosen)) return chosen;
  const { tab, pages } = chosen;

  if (!tab.openedByServer) return errorReply(NOT_OPENED(tab.id));
  if (tab.id === deps.port.connectedTabId())
    return errorReply(CONNECTED(tab.id));
  if (pages <= 1) return errorReply(LAST_PAGE(tab.id));

  if (!(await deps.port.close(tab.id)))
    return errorReply("Failed to close tab");
  return textReply(`Closed tab: ${tab.id}\n${named(tab, deps.quotePage)}`);
}

const NOT_OPENED = (id: string) =>
  `Cannot close tab ${id}: the server did not open it. comet_tabs closes only tabs the server opened; list marks them [OPENED BY SERVER].`;

const CONNECTED = (id: string) =>
  `Cannot close tab ${id}: the connection is on it, and comet_ask and comet_mode work in it. Switch to another tab first.`;

const LAST_PAGE = (id: string) =>
  `Cannot close tab ${id}: it is the last page tab, and Comet needs one open.`;
