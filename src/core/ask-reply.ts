// The ask's outcome in words, for every adapter alike. An adapter only puts
// the reply in its transport's shape.
//
// Text read from the page reaches the reply only through `quotePage`, the
// adapter's UNTRUSTED wrapper. A timeout says the answer may be incomplete
// and names `comet_poll` to follow it, so partial text is never mistaken
// for the answer.

import type { AskOutcome, AskProgress } from "./ask.js";
import { withModeNotice } from "./ask-mode.js";

export interface AskReply {
  readonly text: string;
  readonly isError: boolean;
}

export function describeAskOutcome(
  outcome: AskOutcome,
  quotePage: (pageText: string) => string,
): AskReply {
  switch (outcome.kind) {
    case "refused":
      return { text: `Error: ${outcome.reason}`, isError: true };
    case "failed":
      return {
        text: withModeNotice(outcome.notice, `Error: ${outcome.message}`),
        isError: true,
      };
    case "answered":
      return {
        text: withModeNotice(outcome.notice, quotePage(outcome.answer)),
        isError: false,
      };
    case "timed-out":
      return {
        text: withModeNotice(
          outcome.notice,
          describeTimeout(outcome.timeoutMs, outcome.progress, quotePage),
        ),
        isError: false,
      };
  }
}

function describeTimeout(
  timeoutMs: number,
  progress: AskProgress,
  quotePage: (pageText: string) => string,
): string {
  const lines = [
    `The answer may be incomplete: this ask's ${timeoutMs} ms ran out before Comet finished answering.`,
    `Status: ${progress.status.toUpperCase()}`,
    "",
    ...partialAnswerLines(progress.partialAnswer, quotePage),
    "",
  ];
  const progressText = describeProgress(progress);
  if (progressText) lines.push("Progress:", quotePage(progressText), "");
  lines.push(
    "The task is still active: use comet_poll to follow the answer until it is complete, or comet_stop to cancel it.",
  );
  return lines.join("\n");
}

function partialAnswerLines(
  partialAnswer: string,
  quotePage: (pageText: string) => string,
): string[] {
  if (!partialAnswer) return ["No answer text yet."];
  return ["Partial answer so far:", quotePage(partialAnswer)];
}

/** The current step and the steps seen, or empty when the page showed none. */
function describeProgress({ currentStep, steps }: AskProgress): string {
  const lines: string[] = [];
  if (currentStep) lines.push(`Current: ${currentStep}`);
  if (steps.length > 0) {
    lines.push("Steps:", ...steps.map((step) => `  • ${step}`));
  }
  return lines.join("\n");
}
