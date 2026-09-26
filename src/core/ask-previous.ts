// The answer still in progress when an ask is about to type. Perplexity's
// input bar shows its stop control in the Submit button's place while it
// answers, and a prompt sent then is not taken. When that answer is this
// server's own (an ask that ran out of time, whose task the new ask replaces
// anyway) it is stopped, and the ask's result says so. An answer the server
// did not start, perhaps the user's own, is never stopped: the ask waits for
// it within its own timeout, and when it outlasts that, fails without
// sending, saying how to go on.

import { PromptNotSent } from "./ask-send.js";
import { type StopPort, stopAnswer } from "./ask-stop.js";

/** The waits for an answer in progress, in milliseconds. */
export const PREVIOUS_ANSWER_TIMING = {
  /** Between two looks at the stop control while another answer runs. */
  pollMs: 1500,
} as const;

/** The line an ask's result starts with when it stopped its own answer. */
export const STOPPED_OWN_ANSWER =
  "Comet was still answering this server's previous question, so that answer was stopped before this prompt was sent.";

export interface PreviousAnswer {
  /** Whether the answer in progress, if any, is this server's own. */
  readonly own: boolean;
  /** How long the ask may wait for an answer it did not start. */
  readonly timeoutMs: number;
}

export interface InputBarFree {
  /** The line the ask's result starts with, or null. */
  readonly line: string | null;
  /** How long the ask waited for the input bar. */
  readonly waitedMs: number;
}

/**
 * Leaves the input bar free for the prompt: at once when no answer is in
 * progress, after stopping the server's own, or after waiting for another's.
 * Throws `PromptNotSent` when it cannot, so nothing is typed.
 */
export async function freeInputBar(
  port: StopPort,
  previous: PreviousAnswer,
): Promise<InputBarFree> {
  if ((await port.locateStopControl()) === null) {
    return { line: null, waitedMs: 0 };
  }
  if (previous.own) return stopOwnAnswer(port);
  return waitForOtherAnswer(port, previous.timeoutMs);
}

async function stopOwnAnswer(port: StopPort): Promise<InputBarFree> {
  const outcome = await stopAnswer(port);
  if (outcome.kind === "not-taken") {
    throw new PromptNotSent(
      "previous answer",
      "Comet is still answering this server's previous question, and the stop was not taken: the stop control still shows after a click on it",
    );
  }
  return {
    line: outcome.kind === "stopped" ? STOPPED_OWN_ANSWER : null,
    waitedMs: 0,
  };
}

async function waitForOtherAnswer(
  port: StopPort,
  timeoutMs: number,
): Promise<InputBarFree> {
  const startedAt = port.now();
  while (port.now() - startedAt < timeoutMs) {
    await port.wait(PREVIOUS_ANSWER_TIMING.pollMs);
    if ((await port.locateStopControl()) === null) {
      return { line: null, waitedMs: port.now() - startedAt };
    }
  }
  throw new PromptNotSent(
    "previous answer",
    `Comet was still answering a question this server did not ask when this ask's ${timeoutMs} ms ran out, and such an answer is never stopped. Ask again once it has finished, or stop it with comet_stop first; comet_poll reports this ask as not sent`,
  );
}
