// Sending the prompt: typed into Perplexity's input bar and submitted with
// trusted input, which works whether or not Comet's window has focus, and
// checked after each step, so a failure names the step that failed.
//
// The page scripts select the input bar and read it back; the prompt itself
// reaches the page only through CDP's text insertion, never as script text
// or a script's argument. The field is not cleared on its own: the inserted
// text replaces the selection, so the read-back finds exactly the prompt or
// the text was not taken. The submit is a trusted Enter, and when the page
// has not taken it within a bounded wait, a trusted click on the input
// bar's Submit button.

import type { PagePoint, ProseState } from "../page-scripts.js";
import { PageScriptFailed } from "./page-script-failed.js";

/** What the send step needs from the browser. */
export interface PromptPort {
  /**
   * Focuses the input bar and selects everything in it, so the text inserted
   * next replaces it; false when the page has no input bar.
   */
  selectAskInput(): Promise<boolean>;
  /** The text the input bar holds, or null when the page has none. */
  readAskInput(): Promise<string | null>;
  /** Inserts text at the focused element, as trusted input. */
  insertText(text: string): Promise<void>;
  /** Presses Enter, as trusted input. */
  pressEnter(): Promise<void>;
  /** The centre of the input bar's enabled Submit button, or null. */
  locateSubmitButton(): Promise<PagePoint | null>;
  /** Clicks at a point in the page, as trusted input. */
  clickAt(point: PagePoint): Promise<void>;
  readProseState(): Promise<ProseState>;
  /** Milliseconds, on the clock `wait` advances. */
  now(): number;
  wait(ms: number): Promise<void>;
}

/** The send step's waits, in milliseconds. */
export const SEND_TIMING = {
  /** After inserting the prompt, before reading the field back. */
  typedSettleMs: 300,
  /** How long a submit (the Enter, then the click) has to be taken. */
  submitWaitMs: 3000,
  /** Between two checks that the prompt was submitted. */
  submitPollMs: 250,
} as const;

/** The step of sending a prompt that failed. */
export type SendStep = "input bar" | "text" | "submit";

/**
 * The prompt did not reach Comet; the message names the step. `pageDetail`
 * is the page's own text when a page script threw, kept apart for the
 * adapter's UNTRUSTED wrapper.
 */
export class PromptNotSent extends Error {
  constructor(
    readonly step: SendStep,
    detail: string,
    readonly pageDetail?: string,
  ) {
    super(`The prompt was not sent: ${detail}`);
    this.name = "PromptNotSent";
  }
}

/**
 * Types `prompt` into the input bar and submits it, or throws
 * `PromptNotSent` naming the step that failed. `proseBefore` is the page's
 * prose before sending: an answer that starts shows the prompt submitted.
 */
export async function sendPrompt(
  port: PromptPort,
  prompt: string,
  proseBefore: ProseState,
): Promise<void> {
  await selectInputBar(port);
  await typePrompt(port, prompt);
  await submitPrompt(port, proseBefore);
}

async function selectInputBar(port: PromptPort): Promise<void> {
  const found = await during(
    "input bar",
    "the input bar could not be selected",
    () => port.selectAskInput(),
  );
  if (!found) {
    throw new PromptNotSent(
      "input bar",
      "the input bar was not found on the page",
    );
  }
}

async function typePrompt(port: PromptPort, prompt: string): Promise<void> {
  await during("text", "the text was not taken", () => port.insertText(prompt));
  await port.wait(SEND_TIMING.typedSettleMs);
  const readBack = await during(
    "text",
    "the text was not taken, the input bar could not be read back",
    () => port.readAskInput(),
  );
  const problem = readBackProblem(readBack, prompt);
  if (problem) {
    throw new PromptNotSent("text", `the text was not taken, ${problem}`);
  }
}

/** Why the field's text is not the prompt, or null when it is. */
function readBackProblem(
  readBack: string | null,
  prompt: string,
): string | null {
  if (readBack === null) return "the input bar is gone";
  const text = collapseWhitespace(readBack);
  if (text === collapseWhitespace(prompt)) return null;
  if (text === "") return "the input bar reads back empty";
  return "the input bar reads back other text than the prompt";
}

async function submitPrompt(
  port: PromptPort,
  proseBefore: ProseState,
): Promise<void> {
  const notTaken = "the submit was not taken";
  await during("submit", notTaken, () => port.pressEnter());
  if (await submittedWithin(port, proseBefore)) return;
  const button = await during("submit", notTaken, () =>
    port.locateSubmitButton(),
  );
  if (!button) {
    // The button shows only while the field holds text: an Enter taken just
    // after the wait took the button with the prompt.
    if (await showsSubmitted(port, proseBefore)) return;
    throw new PromptNotSent(
      "submit",
      `${notTaken}, the input bar still holds the prompt after Enter and the page shows no Submit button`,
    );
  }
  await during("submit", notTaken, () => port.clickAt(button));
  if (await submittedWithin(port, proseBefore)) return;
  throw new PromptNotSent(
    "submit",
    `${notTaken}, the input bar still holds the prompt after Enter and a click on the Submit button`,
  );
}

/** True once the field empties or an answer starts, within the submit wait. */
async function submittedWithin(
  port: PromptPort,
  proseBefore: ProseState,
): Promise<boolean> {
  const startedAt = port.now();
  for (;;) {
    if (await showsSubmitted(port, proseBefore)) return true;
    if (port.now() - startedAt >= SEND_TIMING.submitWaitMs) return false;
    await port.wait(SEND_TIMING.submitPollMs);
  }
}

/** A read that fails, as while the page moves to the new thread, is a no. */
async function showsSubmitted(
  port: PromptPort,
  proseBefore: ProseState,
): Promise<boolean> {
  try {
    const field = await port.readAskInput();
    if (field !== null && collapseWhitespace(field) === "") return true;
    return (await port.readProseState()).count > proseBefore.count;
  } catch {
    return false;
  }
}

/** Runs one call of `step`, turning its failure into `PromptNotSent`. */
async function during<T>(
  step: SendStep,
  what: string,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof PageScriptFailed) {
      throw new PromptNotSent(
        step,
        `${what}: ${error.message}`,
        error.pageDetail,
      );
    }
    throw new PromptNotSent(step, `${what}: ${messageOf(error)}`);
  }
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
