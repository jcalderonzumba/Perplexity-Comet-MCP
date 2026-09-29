// Which turn of the thread the page shows, and which one is the ask's own. A
// prompt submitted in a thread shows as a new question block at once, before
// its answer, and the page's answer is always the latest turn's.
//
// The read before sending is only a floor: in a long thread scrolled up the
// page renders the turns near the view, so that read can name a turn below
// the real latest, and a turn above it is not proof of the ask's own. What
// the page proves about the submit is the question block that holds the
// prompt: the ask's own turn is the highest turn above the floor whose
// question block holds it (`ownTurnAmong`), and until the page shows such a
// block no answer is the ask's own. An answer is the ask's own only from
// that turn on (`showsOwnTurn`). One case the page cannot settle: an
// earlier question in the same thread that holds the start of the prompt (an
// identical one, or a longer one such as "What is X and Y?" for the prompt
// "What is X?"), in a turn above a floor that under-reports and not rendered
// before sending, is taken for the ask's own once the page renders that
// earlier turn before the new block.

import type { ThreadState } from "../page-scripts.js";

/** How much of the prompt is looked for in the question blocks. */
const QUESTION_PROBE_LENGTH = 500;

/**
 * Whether `now` shows a turn after the latest one `before` showed; undefined
 * on a page that shows no turn, where the caller falls back to its prose.
 * The send step's test that a prompt was submitted; not proof of the ask's
 * own turn (see `ownTurnAmong`).
 */
export function showsNewTurn(
  before: ThreadState,
  now: ThreadState,
): boolean | undefined {
  if (now.latestTurn === null) return undefined;
  return before.latestTurn === null || now.latestTurn > before.latestTurn;
}

/**
 * The start of the prompt the page is asked to find in its question blocks:
 * bounded, so a long prompt is not sent to the page in full at every read.
 */
export function questionProbe(prompt: string): string {
  return prompt.slice(0, QUESTION_PROBE_LENGTH);
}

/**
 * The ask's own turn among `questionTurns`, the turns whose question block
 * holds its prompt: the highest one above the floor, `before`'s latest turn
 * (a block at or below it was on the page before sending); null while there
 * is none, since the new question's block is not rendered yet.
 */
export function ownTurnAmong(
  questionTurns: readonly number[],
  before: ThreadState,
): number | null {
  const floor = before.latestTurn;
  const fresh = questionTurns.filter((turn) => floor === null || turn > floor);
  return fresh.length > 0 ? Math.max(...fresh) : null;
}

/**
 * Whether the page's latest turn is the ask's own `ownTurn` or a later one;
 * false for every turn while the own turn is not known (null), and undefined
 * on a page that shows no turn.
 */
export function showsOwnTurn(
  ownTurn: number | null,
  now: ThreadState,
): boolean | undefined {
  if (now.latestTurn === null) return undefined;
  return ownTurn !== null && now.latestTurn >= ownTurn;
}
