// Running work with the page's focus emulated. Trusted keys and clicks reach
// a tab whose window is behind others, or that is not the one selected in
// its window, only while the tab believes itself focused and visible: the
// send step's submit, the stop's click and the mode menu's clicks all run
// inside it, and this is the one place that starts it, runs them and always
// stops it.

/** What a core needs of the browser to emulate the page's focus. */
export interface FocusEmulationPort {
  /** Makes the page believe itself focused and visible; refused off Perplexity. */
  startFocusEmulation(): Promise<void>;
  /** Ends `startFocusEmulation`. */
  stopFocusEmulation(): Promise<void>;
}

/**
 * Runs `work` with the page's focus emulated, and stops emulating it
 * whatever `work` does. A failed start runs no work and stops nothing: it
 * goes to `onStartFailure`, whose return value is the result (or which
 * throws the caller's own error). Failing to stop never replaces the work's
 * own outcome: a connection too broken to stop the emulation has ended it
 * with the connection.
 */
export async function withFocusEmulated<T>(
  port: FocusEmulationPort,
  work: () => Promise<T>,
  onStartFailure: (error: unknown) => T,
): Promise<T> {
  try {
    await port.startFocusEmulation();
  } catch (error) {
    return onStartFailure(error);
  }
  try {
    return await work();
  } finally {
    await port.stopFocusEmulation().catch(() => undefined);
  }
}
