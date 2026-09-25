/**
 * Scores the live batteries' checks. Each check reports whether its condition
 * held; this module turns that into a verdict, against a list of known
 * failures, and decides the battery's result.
 *
 * A known failure is a check that fails for a known, dated reason whose fix
 * another plan owns. It is reported, with its actual note, but does not fail
 * the battery. A listed check that passes fails the battery, so the entry is
 * removed once the fix lands.
 *
 * Each battery has its own list, and every scoring names the list it scores
 * against: the batteries share check ids ([1.2], [5.1], [7.x], [9.4]), and an
 * entry excuses its id in its own battery alone.
 */

/** @typedef {"PASS" | "FAIL" | "KNOWN" | "UNEXPECTED PASS"} Verdict */

/** @typedef {{ id: string, reason: string, owningPlan: string }} KnownFailure */

/** @typedef {{ id: string, held: boolean, note: string }} CheckResult */

/** @typedef {{ held: boolean, note: string }} ProbeOutcome */

/** @typedef {{ id: string, verdict: Verdict, note: string, known?: KnownFailure }} ScoredCheck */

const ASK_RELIABILITY = "plan 3 (comet_ask reliability)";
const AGENTIC_BROWSING = "plan 12 (Agentic browsing)";

/**
 * Both batteries switch to the `learn` mode with the same predicate, and
 * fail it for the same reason.
 * @type {KnownFailure}
 */
const LEARN_MODE_NOT_SWITCHED = {
  id: "7.2-learn",
  reason:
    'Perplexity\'s input bar offers "Learn step by step", and comet_mode does not switch to it yet',
  owningPlan: "plan 11 (Learn mode)",
};

/**
 * The no-pro battery's known failures (`tests/run-no-pro.mjs`).
 * @type {readonly KnownFailure[]}
 */
export const NO_PRO_KNOWN_FAILURES = [LEARN_MODE_NOT_SWITCHED];

/** One-word answers, which the ask does not read as complete. */
const SHORT_ANSWER_NOT_READ =
  "comet_ask does not read a one-word answer as complete, so it runs to its timeout and says the answer may be incomplete";

/**
 * The Pro battery's known failures (`tests/run-all.mjs`), in the order its
 * checks run.
 * @type {readonly KnownFailure[]}
 */
export const PRO_KNOWN_FAILURES = [
  { id: "1.5", reason: SHORT_ANSWER_NOT_READ, owningPlan: ASK_RELIABILITY },
  { id: "2.1", reason: SHORT_ANSWER_NOT_READ, owningPlan: ASK_RELIABILITY },
  {
    id: "2.2",
    reason:
      "the follow-up's one-word first turn runs to its timeout, and the follow-up can return an answer that is not the new turn's",
    owningPlan: ASK_RELIABILITY,
  },
  {
    id: "2.3",
    reason:
      "comet_ask does not read the new chat's short answer as complete, so it runs to its timeout and says the answer may be incomplete",
    owningPlan: ASK_RELIABILITY,
  },
  {
    id: "2.5",
    reason:
      'comet_ask can fail to type the prompt, and then reports "Prompt text not found in input"',
    owningPlan: ASK_RELIABILITY,
  },
  {
    id: "2.6-whole-answer",
    reason:
      "comet_ask may return only the end of a multi-paragraph answer, as another Comet MCP server was seen to do, and no run has shown it whole yet",
    owningPlan: ASK_RELIABILITY,
  },
  {
    id: "3.1",
    reason: "Comet answers a prompt that names a site without opening the site",
    owningPlan: AGENTIC_BROWSING,
  },
  {
    id: "3.2-agent-tab",
    reason:
      "Comet answers a prompt that names a site without opening a tab for it",
    owningPlan: AGENTIC_BROWSING,
  },
  {
    id: "3.3-tabs-kept",
    reason:
      "the check needs the agent to open a tab, and Comet answers without opening one",
    owningPlan: AGENTIC_BROWSING,
  },
  {
    id: "3.4",
    reason:
      "Comet answers the multi-step browsing task without browsing, and the ask can return the previous question's answer",
    owningPlan: AGENTIC_BROWSING,
  },
  {
    id: "4.3b",
    reason:
      "after comet_stop, comet_poll returns the stopped task's page text instead of reporting it stopped",
    owningPlan: ASK_RELIABILITY,
  },
  {
    id: "6.3",
    reason:
      "no tab is found for the site, because the agent answered without opening one",
    owningPlan: AGENTIC_BROWSING,
  },
  LEARN_MODE_NOT_SWITCHED,
];

/**
 * Runs one check's probe. A probe that throws or rejects, a timeout included,
 * is a check whose condition did not hold, with the error as its note.
 * @param {string} id
 * @param {() => ProbeOutcome | Promise<ProbeOutcome>} probe
 * @returns {Promise<CheckResult>}
 */
export async function runCheck(id, probe) {
  try {
    const { held, note } = await probe();
    return { id, held, note };
  } catch (error) {
    return { id, held: false, note: errorText(error) };
  }
}

/** @param {unknown} error */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {CheckResult} result
 * @param {readonly KnownFailure[]} knownFailures the list of the battery the check belongs to
 * @returns {ScoredCheck}
 */
export function scoreCheck(result, knownFailures) {
  const known = knownFailures.find((entry) => entry.id === result.id);
  const scored = {
    id: result.id,
    verdict: verdictFor(result.held, known !== undefined),
    note: result.note,
  };
  return known === undefined ? scored : { ...scored, known };
}

/**
 * @param {boolean} held
 * @param {boolean} listed
 * @returns {Verdict}
 */
function verdictFor(held, listed) {
  if (listed) return held ? "UNEXPECTED PASS" : "KNOWN";
  return held ? "PASS" : "FAIL";
}

/**
 * A check that fails the battery: a failure, or a listed check that passed.
 * @param {ScoredCheck} check
 */
function failsTheBattery(check) {
  return check.verdict === "FAIL" || check.verdict === "UNEXPECTED PASS";
}

/**
 * @param {readonly ScoredCheck[]} checks
 * @returns {boolean}
 */
export function batteryPassed(checks) {
  return !checks.some(failsTheBattery);
}

/**
 * The battery's last line. An unexpected pass counts as failed, since it
 * fails the battery.
 * @param {readonly ScoredCheck[]} checks
 * @returns {string}
 */
export function summaryLine(checks) {
  const count = (/** @type {(check: ScoredCheck) => boolean} */ test) =>
    checks.filter(test).length;
  const passed = count((check) => check.verdict === "PASS");
  const failed = count(failsTheBattery);
  const known = count((check) => check.verdict === "KNOWN");
  return `Results: ${passed} passed, ${failed} failed, ${known} known`;
}

/**
 * One check's line: its verdict, id and actual note, so a known failure whose
 * cause changes shows the new cause; a listed check adds its entry.
 * @param {ScoredCheck} check
 * @returns {string}
 */
export function reportLine(check) {
  const line = `${check.verdict} [${check.id}]${check.note ? ` — ${check.note}` : ""}`;
  if (check.known === undefined) return line;
  const entry = `${check.known.owningPlan}: ${check.known.reason}`;
  return check.verdict === "KNOWN"
    ? `${line} (known failure, ${entry})`
    : `${line} (listed as a known failure, ${entry}; remove it from the known failures)`;
}
