/**
 * The Pro battery's checks that have a condition of their own, in the shape
 * of the no-pro checks: which tools each calls, and the condition over the
 * replies that decides whether it held. The Pro battery spends Perplexity
 * Pro queries, so it runs by hand; these conditions are tested without it.
 */

import { runCheck } from "./battery-score.mjs";
import {
  currentMode,
  excerpt,
  replyText,
  succeeded,
  switchedTo,
} from "./no-pro-checks.mjs";

/** @typedef {import("./battery-score.mjs").ProbeOutcome} ProbeOutcome */
/** @typedef {import("./no-pro-checks.mjs").CallTool} CallTool */
/** @typedef {import("./no-pro-checks.mjs").NoProCheck} Check */
/** @typedef {import("./no-pro-checks.mjs").ToolReply} ToolReply */

/**
 * The replies of the research workflow's three calls: `comet_mode research`,
 * `comet_ask` in a new chat, and `comet_mode` with no mode.
 * @typedef {{ switched: ToolReply, asked: ToolReply, read: ToolReply }} ResearchWorkflowReplies
 */

/**
 * What an ask's result says when it is not the final answer: the wording of
 * today's timeout result, and the one principle 7 asks for.
 */
const NOT_FINAL = /may still be in progress|may be incomplete/i;

/** What the timeout result must say: the answer may be incomplete. */
const MAY_BE_INCOMPLETE = /\bmay be incomplete\b/i;
const NAMES_POLL = /\bcomet_poll\b/;

/** A timed-out ask must return well within this, although it asked for 3 s. */
export const TIMEOUT_BOUND_MS = 8000;

/** The words the first turn of [2.2] answers with and the follow-up asks for. */
const NOTED = "NOTED";
const REMEMBERED_NUMBER = "9473";

/** The paragraph openers [2.6-whole-answer] asks for, in order. */
const PARAGRAPH_OPENERS = ["ALPHA", "BRAVO", "CHARLIE"];

/** The site the agent is asked to open in [3.2-agent-tab]. */
export const AGENT_SITE = "example.org";

/** A repository's `owner/name`, and a star count near the word `star`. */
const REPOSITORY = /\b[\w.-]+\/[\w.-]+\b/;
const STAR_COUNT =
  /\d[\d,.]*\s*[kKmM]?\+?\s*(?:github\s+)?stars?\b|\bstars?\W{0,3}\d/i;

/** The first line of `comet_poll`'s reply. */
const POLL_STATUS = /^Status: ([A-Z]+)\b/;

/** `comet_tabs close`'s refusal to leave Comet with no browsing tab. */
const ONLY_BROWSING_TAB = "Cannot close - this is the only browsing tab";

/** An empty prompt's refusal. */
const EMPTY_PROMPT_REFUSED = /^Error: prompt cannot be empty\b/;

/** @param {string} text */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The word, whole and in any case.
 * @param {string} word
 */
function wordPattern(word) {
  return new RegExp(`\\b${escapeRegExp(word)}\\b`, "i");
}

/**
 * The text names the word, whole and in any case.
 * @param {string} text
 * @param {string} word
 */
function namesWord(text, word) {
  return wordPattern(word).test(text);
}

/**
 * The site's host name: the site itself or one of its subdomains.
 * @param {string} host
 * @param {string} site
 */
function onSite(host, site) {
  return host === site || host.endsWith(`.${site}`);
}

/**
 * The ask returned its final answer: no error, and no word that the task may
 * still be in progress or the answer incomplete.
 * @param {ToolReply} reply
 */
export function answered(reply) {
  return succeeded(reply) && !NOT_FINAL.test(replyText(reply));
}

/**
 * [1.5], [2.1], [2.5], [3.1]: the final answer names the word asked for. A
 * login page, an error or a result still in progress fails.
 * @param {ToolReply} reply
 * @param {string} word
 */
export function answerNames(reply, word) {
  return answered(reply) && namesWord(replyText(reply), word);
}

/**
 * [2.2]: the first turn answered, and the follow-up in the same chat answers
 * with the number the first turn gave, never with the first turn's answer.
 * @param {{ first: ToolReply, followUp: ToolReply }} replies
 */
export function followUpAnswered({ first, followUp }) {
  return (
    answerNames(first, NOTED) &&
    answerNames(followUp, REMEMBERED_NUMBER) &&
    !namesWord(replyText(followUp), NOTED)
  );
}

/**
 * [2.3]: the number was given, and the new chat's answer does not know it.
 * @param {{ first: ToolReply, fresh: ToolReply }} replies
 */
export function contextReset({ first, fresh }) {
  return (
    succeeded(first) &&
    answered(fresh) &&
    !namesWord(replyText(fresh), REMEMBERED_NUMBER)
  );
}

/**
 * [2.4]: the ask that ran out of time returned within its bound, and its
 * result says the answer may be incomplete and names `comet_poll` to follow
 * it (principle 7).
 * @param {{ reply: ToolReply, elapsedMs: number }} outcome
 */
export function timeoutStated({ reply, elapsedMs }) {
  const said = replyText(reply);
  return (
    elapsedMs < TIMEOUT_BOUND_MS &&
    succeeded(reply) &&
    MAY_BE_INCOMPLETE.test(said) &&
    NAMES_POLL.test(said)
  );
}

/**
 * [2.6-whole-answer]: the final answer holds every paragraph asked for, in
 * order, not only the last.
 * @param {ToolReply} reply
 */
export function wholeAnswer(reply) {
  if (!answered(reply)) return false;
  const said = replyText(reply);
  const positions = PARAGRAPH_OPENERS.map((word) =>
    said.search(wordPattern(word)),
  );
  return positions.every(
    (position, index) =>
      position >= 0 && position > (positions[index - 1] ?? -1),
  );
}

/**
 * The host names of the tabs `comet_tabs` lists, one per tab.
 * @param {ToolReply} listing
 */
function listedHosts(listing) {
  return [...replyText(listing).matchAll(/^\s*• [A-Z-]+: (\S+)/gm)].map(
    (match) => match[1],
  );
}

/**
 * The addresses of the tabs `comet_tabs` lists, one per tab.
 * @param {ToolReply} listing
 */
function listedAddresses(listing) {
  return [...replyText(listing).matchAll(/^\s*URL: (.*)$/gm)].map(
    (match) => match[1],
  );
}

/**
 * How many listed tabs are on the site.
 * @param {ToolReply} listing
 * @param {string} site
 */
function tabsOnSite(listing, site) {
  return listedHosts(listing).filter((host) => onSite(host, site)).length;
}

/**
 * The tabs listed before the ask and after it.
 * @typedef {{ before: ToolReply, after: ToolReply }} TabListings
 */

/**
 * [3.2-agent-tab]: after the agentic ask, `comet_tabs` lists a tab on the
 * site the prompt named that was not open before it.
 * @param {TabListings} listings
 */
export function agentOpenedTab({ before, after }) {
  return (
    succeeded(before) &&
    succeeded(after) &&
    tabsOnSite(after, AGENT_SITE) > tabsOnSite(before, AGENT_SITE)
  );
}

/**
 * [3.3-tabs-kept]: the agent browsed, and every tab open before its ask is
 * still open after it, at the same address (principle 6). An ask that opened
 * no tab tested nothing, so it does not pass.
 * @param {TabListings} listings
 */
export function tabsKept(listings) {
  if (!agentOpenedTab(listings)) return false;
  const remaining = listedAddresses(listings.after);
  return listedAddresses(listings.before).every((address) => {
    const index = remaining.indexOf(address);
    if (index < 0) return false;
    remaining.splice(index, 1);
    return true;
  });
}

/**
 * [3.4]: the final answer names a repository and its star count.
 * @param {ToolReply} reply
 */
export function trendingRepoNamed(reply) {
  const said = replyText(reply);
  return answered(reply) && REPOSITORY.test(said) && STAR_COUNT.test(said);
}

/**
 * The status `comet_poll` reports on its first line; undefined when the reply
 * is an error or starts with anything else.
 * @param {ToolReply} reply
 */
function pollStatus(reply) {
  return succeeded(reply) ? POLL_STATUS.exec(replyText(reply))?.[1] : undefined;
}

/**
 * [4.1]: with no ask running, the poll reports no task or the last one
 * completed.
 * @param {ToolReply} reply
 */
export function pollIdle(reply) {
  const status = pollStatus(reply);
  return status === "IDLE" || status === "COMPLETED";
}

/**
 * [4.3]: `comet_stop` says it stopped the agent.
 * @param {ToolReply} reply
 */
export function agentStopped(reply) {
  return succeeded(reply) && /^Agent stopped\b/.test(replyText(reply));
}

/**
 * [4.3b]: after the stop, the poll reports the task stopped or no task, not
 * a task working, completed or its answer.
 * @param {ToolReply} reply
 */
export function pollAfterStop(reply) {
  const status = pollStatus(reply);
  return status === "STOPPED" || status === "IDLE";
}

/**
 * [6.3]: `comet_tabs switch` switched to a tab on the site.
 * @param {ToolReply} reply
 * @param {string} site
 */
export function switchedToSite(reply, site) {
  const host = /^Switched to (\S+) \(/.exec(replyText(reply))?.[1];
  return succeeded(reply) && host !== undefined && onSite(host, site);
}

/**
 * [6.4]: `comet_tabs close` closed the site's tab, or refused because it is
 * the only browsing tab (principle 6).
 * @param {ToolReply} reply
 * @param {string} site
 */
export function siteTabClosed(reply, site) {
  const said = replyText(reply);
  if (!succeeded(reply)) return said.startsWith(ONLY_BROWSING_TAB);
  const host = /^Closed (\S+)$/.exec(said.trim())?.[1];
  return host !== undefined && onSite(host, site);
}

/**
 * [8.3]: the upload is an error naming the selector that matched nothing.
 * @param {ToolReply} reply
 * @param {string} selector
 */
export function selectorNotFound(reply, selector) {
  return (
    !succeeded(reply) &&
    replyText(reply).includes(`No element found matching selector: ${selector}`)
  );
}

/**
 * [8.4]: the upload is an error naming the file that does not exist.
 * @param {ToolReply} reply
 * @param {string} path
 */
export function fileNotFound(reply, path) {
  return (
    !succeeded(reply) && replyText(reply).includes(`File not found: ${path}`)
  );
}

/**
 * [9.2]: the empty prompt is refused, not sent.
 * @param {ToolReply} reply
 */
export function emptyPromptRefused(reply) {
  return EMPTY_PROMPT_REFUSED.test(replyText(reply).trim());
}

/** The line `comet_ask`'s result starts with when it could not re-apply the mode. */
const MODE_NOT_APPLIED = /^Mode not applied:/m;

const RESEARCH_WORKFLOW_ID = "7.4-research-workflow";

/** A short prompt: the check is about the mode, not the answer. */
export const RESEARCH_PROMPT = "Reply with exactly one word: RESEARCHED";

/** Deep research takes longer than a search; the server's own ask limit. */
const ASK_TIMEOUT_MS = 180000;
/** The battery's limit on the ask call, past the server's. */
const ASK_CALL_TIMEOUT_MS = 200000;
const MODE_CALL_TIMEOUT_MS = 20000;

/**
 * The ask ran and says nothing of a mode it could not apply.
 * @param {ToolReply} reply
 */
function keptTheMode(reply) {
  return succeeded(reply) && !MODE_NOT_APPLIED.test(replyText(reply));
}

/**
 * [7.4-research-workflow]: `comet_mode research` switched, the `comet_ask`
 * that followed in a new chat carries no could-not-apply line, and the page
 * still reads research afterwards.
 * @param {ResearchWorkflowReplies} replies
 */
export function researchWorkflowHeld({ switched, asked, read }) {
  return (
    switchedTo("research", switched) &&
    keptTheMode(asked) &&
    succeeded(read) &&
    currentMode(read) === "research"
  );
}

/**
 * @param {CallTool} callTool
 * @returns {Promise<ProbeOutcome>}
 */
async function judgeResearchWorkflow(callTool) {
  const switched = await callTool(
    "comet_mode",
    { mode: "research" },
    MODE_CALL_TIMEOUT_MS,
  );
  const asked = await callTool(
    "comet_ask",
    { prompt: RESEARCH_PROMPT, newChat: true, timeout: ASK_TIMEOUT_MS },
    ASK_CALL_TIMEOUT_MS,
  );
  const read = await callTool("comet_mode", {}, MODE_CALL_TIMEOUT_MS);
  return {
    held: researchWorkflowHeld({ switched, asked, read }),
    note: `${excerpt(switched, 40)} / ask: ${excerpt(asked, 80)} / then: ${excerpt(read, 30)}`,
  };
}

/**
 * Puts the page back in Search, so the checks after this one do not ask in
 * Deep research. Never throws: a failure is returned as its text.
 * @param {CallTool} callTool
 * @returns {Promise<string | undefined>} why search could not be put back
 */
async function restoreSearch(callTool) {
  try {
    const reply = await callTool(
      "comet_mode",
      { mode: "search" },
      MODE_CALL_TIMEOUT_MS,
    );
    return switchedTo("search", reply) ? undefined : excerpt(reply, 80);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * The owner's workflow: research set with `comet_mode` survives the new chat
 * `comet_ask` opens. Search is put back afterwards, whatever the outcome.
 * @type {Check}
 */
export const RESEARCH_WORKFLOW = {
  id: RESEARCH_WORKFLOW_ID,
  probe: async (callTool) => {
    const { held, note } = await runCheck(RESEARCH_WORKFLOW_ID, () =>
      judgeResearchWorkflow(callTool),
    );
    const notRestored = await restoreSearch(callTool);
    return {
      held,
      note:
        notRestored === undefined
          ? note
          : `${note} / search not restored: ${notRestored}`,
    };
  },
};
