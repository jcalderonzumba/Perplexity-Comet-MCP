// The outcomes of the ask, the poll and the stop in words, for every adapter
// alike. An adapter only puts the reply in its transport's shape.
//
// Text read from the page reaches the reply only through `quotePage`, the
// adapter's UNTRUSTED wrapper. A timeout, and a poll of a task still
// working, say the answer may be incomplete and name `comet_poll` to follow
// it, so partial text is never mistaken for the answer.

import type {
  AskOutcome,
  AskProgress,
  PollOutcome,
  PollProgress,
  StopOutcome,
} from "./ask.js";
import { withModeNotice } from "./ask-mode.js";

const TASK_STILL_ACTIVE =
  "The task is still active: use comet_poll to follow the answer until it is complete, or comet_stop to cancel it.";

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
        text: withModeNotice(
          outcome.notice,
          failureLine(outcome.message, outcome.pageDetail, quotePage),
        ),
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

/** `Error: ` and the message, then the page's part quoted when there is one. */
function failureLine(
  message: string,
  pageDetail: string | undefined,
  quotePage: (pageText: string) => string,
): string {
  const line = `Error: ${message}`;
  return pageDetail === undefined ? line : `${line}: ${quotePage(pageDetail)}`;
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
  lines.push(TASK_STILL_ACTIVE);
  return lines.join("\n");
}

function partialAnswerLines(
  partialAnswer: string,
  quotePage: (pageText: string) => string,
): string[] {
  if (!partialAnswer) return ["No answer text yet."];
  return ["Partial answer so far:", quotePage(partialAnswer)];
}

export function describePollOutcome(
  outcome: PollOutcome,
  quotePage: (pageText: string) => string,
): AskReply {
  return {
    text: pollText(outcome, quotePage),
    isError: outcome.kind === "page-error",
  };
}

export function describeStopOutcome({ stopped }: StopOutcome): AskReply {
  return {
    text: stopped ? "Agent stopped" : "No active agent to stop",
    isError: false,
  };
}

function pollText(
  outcome: PollOutcome,
  quotePage: (pageText: string) => string,
): string {
  switch (outcome.kind) {
    case "no-task":
      return "Status: IDLE\nNo active task. Use comet_ask to start a new task.";
    case "expired":
      return "Status: IDLE\nPrevious task session expired. Use comet_ask to start a new task.";
    case "not-sent":
      return "Status: IDLE\nThe last task's prompt was not sent, so there is no answer to follow. Use comet_ask to start a new task.";
    case "completed":
      return `Status: COMPLETED (${outcome.secondsAgo}s ago)\n\n${quotePage(outcome.answer)}`;
    case "answered":
      return `Status: COMPLETED\n\n${quotePage(outcome.answer)}`;
    case "working":
      return describeWorking(outcome.taskId, outcome.progress, quotePage);
    case "not-followed":
      return describeNotFollowed(outcome.taskId, outcome.progress, quotePage);
    case "page-error":
      return [
        ...statusLines("unknown", outcome.taskId),
        failureLine(outcome.message, outcome.pageDetail, quotePage),
        "",
        TASK_STILL_ACTIVE,
      ].join("\n");
  }
}

function describeWorking(
  taskId: string | null,
  progress: PollProgress,
  quotePage: (pageText: string) => string,
): string {
  const lines = [
    ...statusLines("working", taskId),
    "The answer may be incomplete: Comet is still answering.",
    "",
    ...partialAnswerLines(progress.partialAnswer, quotePage),
    "",
  ];
  const progressText = describeProgress(progress);
  if (progressText) lines.push("Progress:", quotePage(progressText), "");
  lines.push(
    "[Use comet_poll again to follow the answer until it is complete, comet_stop to interrupt, or comet_screenshot to see current page]",
  );
  return lines.join("\n");
}

function describeNotFollowed(
  taskId: string | null,
  progress: PollProgress,
  quotePage: (pageText: string) => string,
): string {
  const lines = [
    ...statusLines(progress.status, taskId),
    "No answer to follow: the task was stopped.",
  ];
  const progressText = describeProgress(progress);
  if (progressText) lines.push("", "Progress:", quotePage(progressText));
  if (progress.status === "working") {
    lines.push(
      "",
      "[Use comet_stop to interrupt, or comet_screenshot to see current page]",
    );
  }
  return lines.join("\n");
}

function statusLines(
  status: PollProgress["status"],
  taskId: string | null,
): string[] {
  const lines = [`Status: ${status.toUpperCase()}`];
  if (taskId) lines.push(`Task: ${taskId}`);
  return lines;
}

/**
 * The tab the agent browses, the current step and the steps seen, or empty
 * when the page showed none.
 */
function describeProgress({
  currentStep,
  steps,
  browsingUrl,
}: AskProgress & { readonly browsingUrl?: string }): string {
  const lines: string[] = [];
  if (browsingUrl) lines.push(`Browsing: ${browsingUrl}`);
  if (currentStep) lines.push(`Current: ${currentStep}`);
  if (steps.length > 0) {
    lines.push("Steps:", ...steps.map((step) => `  • ${step}`));
  }
  return lines.join("\n");
}
