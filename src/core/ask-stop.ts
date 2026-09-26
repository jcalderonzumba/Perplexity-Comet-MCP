// Stopping the answer in progress: a trusted click on the input bar's stop
// control, which `locateStopControl` finds by its label, never by its icon,
// so no other button (a pane's, the dictation's, the read-aloud player's)
// is ever pressed. The browser drops a trusted click to a hidden tab, one
// not selected in its window, and may for a window behind others, so focus
// is emulated around the click, as around the send step's submit, and the
// stop is taken once the control is gone.

import type { PagePoint } from "../page-scripts.js";

/** What the stop needs from the browser. */
export interface StopPort {
  /** The centre of the input bar's stop control, or null when none shows. */
  locateStopControl(): Promise<PagePoint | null>;
  /** Clicks at a point in the page, as trusted input. */
  clickAt(point: PagePoint): Promise<void>;
  /** Makes the page believe itself focused and visible; refused off Perplexity. */
  startFocusEmulation(): Promise<void>;
  /** Ends `startFocusEmulation`. */
  stopFocusEmulation(): Promise<void>;
  /** Milliseconds, on the clock `wait` advances. */
  now(): number;
  wait(ms: number): Promise<void>;
}

/** The stop's waits, in milliseconds. */
export const STOP_TIMING = {
  /** How long the stop control has to go once clicked. */
  takenWaitMs: 3000,
  /** Between two checks that it went. */
  pollMs: 250,
} as const;

export type StopOutcome =
  /** The stop control was clicked, and is gone. */
  | { readonly kind: "stopped" }
  /** The page shows no stop control: nothing was clicked. */
  | { readonly kind: "nothing-to-stop" }
  /** The stop control still shows after a click on it. */
  | { readonly kind: "not-taken" };

/** Clicks the stop control when the page shows one, and says what happened. */
export async function stopAnswer(port: StopPort): Promise<StopOutcome> {
  const control = await port.locateStopControl();
  if (control === null) return { kind: "nothing-to-stop" };
  await port.startFocusEmulation();
  try {
    await port.clickAt(control);
    return (await goneWithin(port))
      ? { kind: "stopped" }
      : { kind: "not-taken" };
  } finally {
    await port.stopFocusEmulation().catch(() => undefined);
  }
}

/** True once the stop control is gone, within the stop's wait. */
async function goneWithin(port: StopPort): Promise<boolean> {
  const startedAt = port.now();
  for (;;) {
    if (await isGone(port)) return true;
    if (port.now() - startedAt >= STOP_TIMING.takenWaitMs) return false;
    await port.wait(STOP_TIMING.pollMs);
  }
}

/** A read that fails, as while the page re-renders, is a no. */
async function isGone(port: StopPort): Promise<boolean> {
  try {
    return (await port.locateStopControl()) === null;
  } catch {
    return false;
  }
}
