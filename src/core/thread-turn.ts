// Which turn of the thread the page shows, and which one is the ask's own. A
// prompt submitted in a thread shows as a new question block at once, before
// its answer, and the page's answer is always the latest turn's.
//
// The read before sending is only a floor: in a long thread scrolled up the
// page renders the turns near the view, so that read can name a turn below
// the real latest, and a turn above it is not proof of the ask's own. The
// ask's own turn is therefore marked from a second read, taken once the
// submit is confirmed (`ownTurnFrom`), and an answer is the ask's own only
// from that turn on (`showsOwnTurn`).

import type { ThreadState } from "../page-scripts.js";

/**
 * Whether `now` shows a turn after the latest one `before` showed; undefined
 * on a page that shows no turn, where the caller falls back to its prose.
 * The send step's test that a prompt was submitted; not proof of the ask's
 * own turn (see `ownTurnFrom`).
 */
export function showsNewTurn(
  before: ThreadState,
  now: ThreadState,
): boolean | undefined {
  if (now.latestTurn === null) return undefined;
  return before.latestTurn === null || now.latestTurn > before.latestTurn;
}

/**
 * The index of the ask's own turn, marked once its submit was confirmed:
 * the latest turn the page showed then, when that is above the floor (the
 * new question block is there); otherwise the turn after the floor, since
 * the block is not rendered yet and the page still shows earlier turns.
 * After a page that showed none, the first turn.
 */
export function ownTurnFrom(
  before: ThreadState,
  atSubmit: ThreadState,
): number {
  if (atSubmit.latestTurn !== null && showsNewTurn(before, atSubmit)) {
    return atSubmit.latestTurn;
  }
  return before.latestTurn === null ? 0 : before.latestTurn + 1;
}

/**
 * Whether the page's latest turn is the ask's own `ownTurn` or a later one;
 * undefined on a page that shows no turn.
 */
export function showsOwnTurn(
  ownTurn: number,
  now: ThreadState,
): boolean | undefined {
  if (now.latestTurn === null) return undefined;
  return now.latestTurn >= ownTurn;
}
