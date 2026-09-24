/**
 * The Pro battery's checks that have a condition of their own, in the shape
 * of the no-pro checks: which tools each calls, and the condition over the
 * replies that decides whether it held. The Pro battery spends Perplexity
 * Pro queries, so it runs by hand; these conditions are tested without it.
 */

import { runCheck } from "./battery-score.mjs";
import {
  currentMode,
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
 * @param {ToolReply} reply
 * @param {number} length
 */
function excerpt(reply, length) {
  return replyText(reply).slice(0, length);
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
