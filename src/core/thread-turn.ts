// Which turn of the thread the page shows. A prompt submitted in a thread
// shows as a new question block at once, before its answer, and the page's
// answer is always the latest turn's; so an answer is the ask's own exactly
// when the page shows a turn after the one it showed before the prompt was
// sent, whatever the answer's text.

import type { ThreadState } from "../page-scripts.js";

/**
 * Whether `now` shows a turn after the latest one `before` showed; undefined
 * on a page that shows no turn, where the caller falls back to its prose.
 */
export function showsNewTurn(
  before: ThreadState,
  now: ThreadState,
): boolean | undefined {
  if (now.latestTurn === null) return undefined;
  return before.latestTurn === null || now.latestTurn > before.latestTurn;
}
