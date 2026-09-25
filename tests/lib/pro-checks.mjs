/**
 * The Pro battery's checks, in the shape of the no-pro checks: which tools
 * each calls, and the condition over the replies that decides whether it
 * held. Every condition can fail. The battery script supplies the server
 * connection and the printing; scoring is `battery-score.mjs`'s, against
 * the Pro battery's own known failures. The Pro battery spends Perplexity
 * Pro queries, so it runs by hand; these conditions are tested without it.
 * The checks both batteries run are the no-pro battery's.
 */

import { PRO_KNOWN_FAILURES, runCheck, scoreCheck } from "./battery-score.mjs";
import {
  connectCheck,
  currentMode,
  excerpt,
  INVALID_MODE_REJECTED,
  MODE_REPORTED,
  MODE_SWITCHES,
  replyText,
  SCREENSHOT_TAKEN,
  singleCall,
  succeeded,
  switchedTo,
  TABS_LISTED,
} from "./no-pro-checks.mjs";

/** @typedef {import("./battery-score.mjs").ProbeOutcome} ProbeOutcome */
/** @typedef {import("./no-pro-checks.mjs").CallTool} CallTool */
/** @typedef {import("./no-pro-checks.mjs").NoProCheck} Check */
/** @typedef {import("./no-pro-checks.mjs").ToolReply} ToolReply */
/** @typedef {import("./no-pro-checks.mjs").DebugPort} DebugPort */
/** @typedef {import("./battery-score.mjs").ScoredCheck} ScoredCheck */

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
const TIMEOUT_BOUND_MS = 8000;

/** [1.5]'s prompt, which names the word its answer must name. */
const SESSION_PROMPT = "Reply with exactly one word: VERIFIED";

/** [2.5]'s prompt, sent after its context, which names the project. */
const CONTEXT_PROMPT = "What is the project name?";

/** The words the first turn of [2.2] answers with and the follow-up asks for. */
const NOTED = "NOTED";
const REMEMBERED_NUMBER = "9473";

/** The paragraph openers [2.6-whole-answer] asks for, in order. */
const PARAGRAPH_OPENERS = ["ALPHA", "BRAVO", "CHARLIE"];

/** The site the agent is asked to open in [3.2-agent-tab]. */
const AGENT_SITE = "example.org";

/** The site the tab checks, and [3.1] before them, send the agent to. */
const VISITED_SITE = "example.com";

/**
 * The sites the browsing asks before [3.4] name. [3.4]'s own prompt names
 * neither, so its reply naming one carries an earlier ask's answer.
 */
const EARLIER_BROWSING_SITES = [VISITED_SITE, AGENT_SITE];

/**
 * A GitHub repository's `owner/name`, on its own or in its github.com
 * address. An owner has no dots, so a web address's path (`news.site/x`)
 * is not one.
 */
const REPOSITORY = /(?:\bgithub\.com\/|(?<![\w./-]))[\w-]+\/[\w.-]+/i;

/** A star count near the word `star`. */
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
 * [2.1], [3.1]: the final answer names the word asked for. A
 * login page, an error or a result still in progress fails.
 * @param {ToolReply} reply
 * @param {string} word
 */
export function answerNames(reply, word) {
  return answered(reply) && namesWord(replyText(reply), word);
}

/**
 * The text, with its runs of whitespace made single spaces, in lower case.
 * @param {string} text
 */
function normalised(text) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * The reply holds the prompt, read back from the page, in any case and
 * however its lines were broken.
 * @param {ToolReply} reply
 * @param {string} prompt
 */
function echoes(reply, prompt) {
  return normalised(replyText(reply)).includes(normalised(prompt));
}

/**
 * [1.5], [2.5]: the final answer names the word, and does not hold the
 * prompt, which names the word itself: a reply that reads the question back
 * from the page could pass on the question alone.
 * @param {ToolReply} reply
 * @param {string} word
 * @param {string} prompt
 */
export function answerNamesWithoutEcho(reply, word, prompt) {
  return answerNames(reply, word) && !echoes(reply, prompt);
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
 * The word opening a line, after any spaces, whole and in any case.
 * @param {string} word
 */
function lineOpenerPattern(word) {
  return new RegExp(`^[ \\t]*${escapeRegExp(word)}\\b`, "im");
}

/**
 * [2.6-whole-answer]: the final answer holds every paragraph asked for, in
 * order, not only the last. Each paragraph's word opens a line: the prompt
 * names the words mid-sentence, so a reply that reads it back fails.
 * @param {ToolReply} reply
 */
export function wholeAnswer(reply) {
  if (!answered(reply)) return false;
  const said = replyText(reply);
  const positions = PARAGRAPH_OPENERS.map((word) =>
    said.search(lineOpenerPattern(word)),
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
  return agentOpenedTab(listings) && tabsGone(listings) === 0;
}

/**
 * How many tabs listed before the ask are not listed after it at the same
 * address.
 * @param {TabListings} listings
 */
function tabsGone({ before, after }) {
  const remaining = listedAddresses(after);
  return listedAddresses(before).filter((address) => {
    const index = remaining.indexOf(address);
    if (index >= 0) remaining.splice(index, 1);
    return index < 0;
  }).length;
}

/**
 * The text names a site one of the browsing asks before [3.4] named.
 * @param {string} text
 */
function namesEarlierBrowsingSite(text) {
  return EARLIER_BROWSING_SITES.some((site) => namesWord(text, site));
}

/**
 * [3.4]: the final answer names a GitHub repository and its star count, and
 * carries no earlier browsing ask's answer, which a reply run on from it
 * could hold beside text that looks like a repository.
 * @param {ToolReply} reply
 */
export function trendingRepoNamed(reply) {
  const said = replyText(reply);
  return (
    answered(reply) &&
    !namesEarlierBrowsingSite(said) &&
    REPOSITORY.test(said) &&
    STAR_COUNT.test(said)
  );
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

// ─── The battery ───────────────────────────────────────────────────────────

/** The file the upload checks send; the battery script writes it first. */
export const UPLOAD_TEST_FILE = "/tmp/comet-test-upload.txt";
const MISSING_FILE = "/tmp/file-that-does-not-exist-xyzabc.txt";
const MISSING_SELECTOR = "#does-not-exist-xyzabc";

/**
 * How long the server may take over an ask (its `timeout`), and how long
 * the battery waits for the call: longer, so that a slow answer is judged
 * on the server's own result, not on the battery giving up first.
 * @typedef {{ timeout: number, callLimit: number }} AskLimits
 */

/** @type {AskLimits} */
const ANSWER = { timeout: 60000, callLimit: 75000 };
/** @type {AskLimits} */
const BROWSING = { timeout: 90000, callLimit: 105000 };
/** @type {AskLimits} */
const LONG_TASK = { timeout: 120000, callLimit: 135000 };
/** [2.4]'s ask: far too short for its essay. */
/** @type {AskLimits} */
const RUNS_OUT = { timeout: 3000, callLimit: 10000 };

const TOOL_CALL_MS = 10000;
const UPLOAD_CALL_MS = 15000;
const EMPTY_PROMPT_CALL_MS = 30000;

/** How long [4.3] lets the slow task start, and [4.3b] lets the stop settle. */
const STOP_AFTER_MS = 3000;
const POLL_AFTER_MS = 1000;

/** How much of an ask's reply a check's note shows. */
const ANSWER_NOTE_LENGTH = 160;

/**
 * Asks within the limits.
 * @param {CallTool} callTool
 * @param {AskLimits} limits
 * @param {Record<string, unknown>} args
 */
function ask(callTool, limits, args) {
  return callTool(
    "comet_ask",
    { ...args, timeout: limits.timeout },
    limits.callLimit,
  );
}

/**
 * A check's outcome: the predicate over the reply, and the reply's start.
 * @param {ToolReply} reply
 * @param {(reply: ToolReply) => boolean} predicate
 * @returns {ProbeOutcome}
 */
function judged(reply, predicate) {
  return { held: predicate(reply), note: excerpt(reply, ANSWER_NOTE_LENGTH) };
}

/**
 * A check of one ask, judged on its answer.
 * @param {string} id
 * @param {AskLimits} limits
 * @param {Record<string, unknown>} args
 * @param {(reply: ToolReply) => boolean} predicate
 * @returns {Check}
 */
function askCheck(id, limits, args, predicate) {
  return singleCall(
    id,
    "comet_ask",
    { ...args, timeout: limits.timeout },
    limits.callLimit,
    (reply) => judged(reply, predicate),
  );
}

/**
 * A check of one call to a tool other than `comet_ask`.
 * @param {string} id
 * @param {string} tool
 * @param {Record<string, unknown>} args
 * @param {number} timeoutMs
 * @param {(reply: ToolReply) => boolean} predicate
 * @returns {Check}
 */
function toolCheck(id, tool, args, timeoutMs, predicate) {
  return singleCall(id, tool, args, timeoutMs, (reply) =>
    judged(reply, predicate),
  );
}

/**
 * Runs a scenario once, for the first check that needs it; the checks that
 * judge the same calls share its outcome, or its error.
 * @template T
 * @param {(callTool: CallTool) => Promise<T>} scenario
 * @returns {(callTool: CallTool) => Promise<T>}
 */
function shared(scenario) {
  /** @type {Promise<T> | undefined} */
  let outcome;
  return (callTool) => {
    outcome ??= scenario(callTool);
    return outcome;
  };
}

/**
 * [2.2]: a one-word first turn in a new chat, then a follow-up in the same
 * chat whose answer is not the first turn's. It also shows the follow-up
 * returns the new turn's answer.
 * @type {Check}
 */
const FOLLOW_UP = {
  id: "2.2",
  probe: async (callTool) => {
    const first = await ask(callTool, ANSWER, {
      prompt: `Remember the number ${REMEMBERED_NUMBER}. Reply with exactly one word: ${NOTED}`,
      newChat: true,
    });
    const followUp = await ask(callTool, ANSWER, {
      prompt:
        "What number did I ask you to remember? Reply with the number only.",
    });
    return {
      held: followUpAnswered({ first, followUp }),
      note: `${excerpt(first, ANSWER_NOTE_LENGTH)} / then: ${excerpt(followUp, ANSWER_NOTE_LENGTH)}`,
    };
  },
};

/**
 * [2.3]: a number given in one new chat is unknown in the next.
 * @type {Check}
 */
const CONTEXT_RESET = {
  id: "2.3",
  probe: async (callTool) => {
    const first = await ask(callTool, ANSWER, {
      prompt: `Remember the number ${REMEMBERED_NUMBER}.`,
      newChat: true,
    });
    const fresh = await ask(callTool, ANSWER, {
      prompt: "What number did I ask you to remember?",
      newChat: true,
    });
    return {
      held: contextReset({ first, fresh }),
      note: excerpt(fresh, ANSWER_NOTE_LENGTH),
    };
  },
};

/**
 * [2.4]: an ask given 3 s for a long essay returns in time and says its
 * answer may be incomplete.
 * @type {Check}
 */
const TIMEOUT_STATED = {
  id: "2.4",
  probe: async (callTool) => {
    const start = Date.now();
    const reply = await ask(callTool, RUNS_OUT, {
      prompt: "Write a 10000 word essay on the history of Rome.",
    });
    const elapsedMs = Date.now() - start;
    return {
      held: timeoutStated({ reply, elapsedMs }),
      note: `returned in ${elapsedMs}ms: ${excerpt(reply, ANSWER_NOTE_LENGTH)}`,
    };
  },
};

/**
 * The tabs listed before and after an ask that sends the agent to a site.
 * @param {CallTool} callTool
 * @returns {Promise<TabListings>}
 */
async function listTabsAroundAgentAsk(callTool) {
  const before = await callTool("comet_tabs", {}, TOOL_CALL_MS);
  await ask(callTool, BROWSING, {
    prompt: `Go to ${AGENT_SITE} and tell me the page heading.`,
  });
  const after = await callTool("comet_tabs", {}, TOOL_CALL_MS);
  return { before, after };
}

/**
 * What the listings show, without the addresses of tabs the user opened.
 * @param {TabListings} listings
 */
function tabsNote(listings) {
  return `${AGENT_SITE} tabs: ${tabsOnSite(listings.before, AGENT_SITE)} before the ask, ${tabsOnSite(listings.after, AGENT_SITE)} after; tabs gone: ${tabsGone(listings)} of ${listedAddresses(listings.before).length}`;
}

/**
 * The replies of the stop and the poll after it.
 * @typedef {{ stop: ToolReply, poll: ToolReply }} StopReplies
 */

/**
 * Starts a slow agentic task, stops it, and polls. The task's own call is
 * waited for before anything else runs.
 * @param {CallTool} callTool
 * @param {(ms: number) => Promise<void>} wait
 * @returns {Promise<StopReplies>}
 */
async function stopSlowTask(callTool, wait) {
  const slowTask = ask(callTool, LONG_TASK, {
    prompt:
      "Go to wikipedia.org and summarize the entire featured article in extreme detail.",
  }).catch(() => undefined);
  try {
    await wait(STOP_AFTER_MS);
    const stop = await callTool("comet_stop", {}, TOOL_CALL_MS);
    await wait(POLL_AFTER_MS);
    const poll = await callTool("comet_poll", {}, TOOL_CALL_MS);
    return { stop, poll };
  } finally {
    await slowTask;
  }
}

/**
 * [5.2]: a screenshot after the agent visits a site.
 * @type {Check}
 */
const SCREENSHOT_AFTER_VISIT = {
  id: "5.2",
  probe: async (callTool) => {
    await ask(callTool, BROWSING, { prompt: `Go to ${VISITED_SITE}.` });
    return SCREENSHOT_TAKEN.probe(callTool);
  },
};

/**
 * [6.3]: after the agent visits a site, `comet_tabs` switches to its tab.
 * @type {Check}
 */
const SITE_TAB_SWITCHED = {
  id: "6.3",
  probe: async (callTool) => {
    await ask(callTool, BROWSING, { prompt: `Go to ${VISITED_SITE}.` });
    const reply = await callTool(
      "comet_tabs",
      { action: "switch", domain: VISITED_SITE },
      TOOL_CALL_MS,
    );
    return judged(reply, (switched) => switchedToSite(switched, VISITED_SITE));
  },
};

/**
 * The checks after connect, in the order they run. The checks that judge
 * the same calls share them, so each battery run builds its own list.
 * @param {(ms: number) => Promise<void>} wait
 * @returns {readonly Check[]}
 */
function afterConnect(wait) {
  const browsed = shared(listTabsAroundAgentAsk);
  const stopped = shared((callTool) => stopSlowTask(callTool, wait));
  return [
    askCheck("1.5", ANSWER, { prompt: SESSION_PROMPT }, (reply) =>
      answerNamesWithoutEcho(reply, "VERIFIED", SESSION_PROMPT),
    ),
    askCheck(
      "2.1",
      ANSWER,
      { prompt: "What is the capital of France? Reply in one word." },
      (reply) => answerNames(reply, "Paris"),
    ),
    FOLLOW_UP,
    CONTEXT_RESET,
    TIMEOUT_STATED,
    askCheck(
      "2.5",
      ANSWER,
      { prompt: CONTEXT_PROMPT, context: "Project name: Artemis" },
      (reply) => answerNamesWithoutEcho(reply, "Artemis", CONTEXT_PROMPT),
    ),
    askCheck(
      "2.6-whole-answer",
      ANSWER,
      {
        prompt: `Write three short paragraphs about the sea. Start the first with the word ${PARAGRAPH_OPENERS[0]}, the second with the word ${PARAGRAPH_OPENERS[1]} and the third with the word ${PARAGRAPH_OPENERS[2]}.`,
      },
      wholeAnswer,
    ),
    askCheck(
      "3.1",
      BROWSING,
      { prompt: `Go to ${VISITED_SITE} and tell me the page heading.` },
      (reply) => answerNames(reply, "Example Domain"),
    ),
    {
      id: "3.2-agent-tab",
      probe: async (callTool) => {
        const listings = await browsed(callTool);
        return { held: agentOpenedTab(listings), note: tabsNote(listings) };
      },
    },
    {
      id: "3.3-tabs-kept",
      probe: async (callTool) => {
        const listings = await browsed(callTool);
        return { held: tabsKept(listings), note: tabsNote(listings) };
      },
    },
    askCheck(
      "3.4",
      LONG_TASK,
      {
        prompt:
          "Go to github.com/trending, find the top-ranked repository today, and tell me its name and star count.",
      },
      trendingRepoNamed,
    ),
    toolCheck("4.1", "comet_poll", {}, TOOL_CALL_MS, pollIdle),
    {
      id: "4.3",
      probe: async (callTool) =>
        judged((await stopped(callTool)).stop, agentStopped),
    },
    {
      id: "4.3b",
      probe: async (callTool) =>
        judged((await stopped(callTool)).poll, pollAfterStop),
    },
    SCREENSHOT_TAKEN,
    SCREENSHOT_AFTER_VISIT,
    TABS_LISTED,
    SITE_TAB_SWITCHED,
    toolCheck(
      "6.4",
      "comet_tabs",
      { action: "close", domain: VISITED_SITE },
      TOOL_CALL_MS,
      (reply) => siteTabClosed(reply, VISITED_SITE),
    ),
    MODE_REPORTED,
    ...MODE_SWITCHES,
    RESEARCH_WORKFLOW,
    toolCheck(
      "8.3",
      "comet_upload",
      { filePath: UPLOAD_TEST_FILE, selector: MISSING_SELECTOR },
      UPLOAD_CALL_MS,
      (reply) => selectorNotFound(reply, MISSING_SELECTOR),
    ),
    toolCheck(
      "8.4",
      "comet_upload",
      { filePath: MISSING_FILE },
      UPLOAD_CALL_MS,
      (reply) => fileNotFound(reply, MISSING_FILE),
    ),
    toolCheck(
      "9.2",
      "comet_ask",
      { prompt: "" },
      EMPTY_PROMPT_CALL_MS,
      emptyPromptRefused,
    ),
    INVALID_MODE_REJECTED,
  ];
}

/** @param {number} ms */
function pause(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

/**
 * @param {Check} check
 * @param {CallTool} callTool
 */
async function scored(check, callTool) {
  return scoreCheck(
    await runCheck(check.id, () => check.probe(callTool)),
    PRO_KNOWN_FAILURES,
  );
}

/**
 * Runs the battery against a server. When [1.2] fails, no other check is
 * run or scored: any other call could make the server launch Comet, or
 * kill and relaunch one listening on another port.
 * @param {CallTool} callTool
 * @param {DebugPort} debugPort
 * @param {(check: ScoredCheck) => void} [report] called as each check is scored
 * @param {(ms: number) => Promise<void>} [wait] how the battery waits between calls
 * @returns {Promise<ScoredCheck[]>}
 */
export async function runProBattery(
  callTool,
  debugPort,
  report = () => {},
  wait = pause,
) {
  const connect = await scored(connectCheck(debugPort), callTool);
  report(connect);
  const checks = [connect];
  if (connect.verdict !== "PASS") return checks;
  for (const check of afterConnect(wait)) {
    const result = await scored(check, callTool);
    report(result);
    checks.push(result);
  }
  return checks;
}
