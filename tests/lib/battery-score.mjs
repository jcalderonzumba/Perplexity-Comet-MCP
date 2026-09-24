/**
 * Scores the live batteries' checks. Each check reports whether its condition
 * held; this module turns that into a verdict, against a list of known
 * failures, and decides the battery's result.
 *
 * A known failure is a check that fails for a known, dated reason whose fix
 * another plan owns. It is reported, with its actual note, but does not fail
 * the battery. A listed check that passes fails the battery, so the entry is
 * removed once the fix lands.
 */

/** @typedef {"PASS" | "FAIL" | "KNOWN" | "UNEXPECTED PASS"} Verdict */

/** @typedef {{ id: string, reason: string, owningPlan: string }} KnownFailure */

/** @typedef {{ id: string, held: boolean, note: string }} CheckResult */

/** @typedef {{ held: boolean, note: string }} ProbeOutcome */

/** @typedef {{ id: string, verdict: Verdict, note: string, known?: KnownFailure }} ScoredCheck */

const MODE_PICKER_MOVED =
  'Perplexity moved Labs (now "Create files and apps") and Learn out of the mode dropdown into the input bar\'s "+" menu in February 2026';

/** @type {readonly KnownFailure[]} */
export const KNOWN_FAILURES = [
  {
    id: "7.2-labs",
    reason: MODE_PICKER_MOVED,
    owningPlan: "plan 5 (research mode)",
  },
  {
    id: "7.2-learn",
    reason: MODE_PICKER_MOVED,
    owningPlan: "plan 5 (research mode)",
  },
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
 * @param {readonly KnownFailure[]} [knownFailures]
 * @returns {ScoredCheck}
 */
export function scoreCheck(result, knownFailures = KNOWN_FAILURES) {
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
