// Each adapter's reply to a tool, in its transport's shape, and the outcomes
// of `comet_ask`, `comet_poll` and `comet_stop` as each adapter renders them:
// the core's words, with page text wrapped by the shared UNTRUSTED wrapper.

import { describe, expect, it } from "vitest";
import type { AskOutcome, PollOutcome } from "../../src/core/ask.js";
import {
  describeAskOutcome,
  describePollOutcome,
  describeStopOutcome,
} from "../../src/core/ask-reply.js";
import { toBridgeResult, toStdioResult } from "../../src/tool-results.js";
import { wrapUntrustedPageContent } from "../../src/untrusted.js";

const MODE_LINE =
  "Mode not applied: this answer may not be in research mode. The mode button was not found.";

const TIMED_OUT: AskOutcome = {
  kind: "timed-out",
  timeoutMs: 3000,
  progress: {
    status: "working",
    partialAnswer: "Rome was founded",
    currentStep: "Writing",
    steps: ["Searching"],
  },
  notice: { line: null },
};

const ANSWERED: AskOutcome = {
  kind: "answered",
  answer: "Paris",
  notice: { line: MODE_LINE },
};

const REFUSED: AskOutcome = {
  kind: "refused",
  reason: "prompt cannot be empty",
};

function rendered(outcome: AskOutcome) {
  return describeAskOutcome(outcome, wrapUntrustedPageContent);
}

/** The text of a stdio result's one text block. */
function textOf(result: ReturnType<typeof toStdioResult>): string {
  const [block] = result.content;
  if (block?.type !== "text") throw new Error("expected one text block");
  return block.text;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `pageText` between the UNTRUSTED markers, whatever their nonce. */
function wrapped(pageText: string): string {
  return [
    String.raw`\[BEGIN UNTRUSTED PAGE CONTENT nonce=([0-9a-f]{16}) [^\]\n]*\]`,
    escapeRegExp(pageText),
    String.raw`\[END UNTRUSTED PAGE CONTENT nonce=\1\]`,
  ].join("\n");
}

describe("toStdioResult", () => {
  it("puts a reply's text in one text block", () => {
    expect(
      toStdioResult({ text: "Switched to search mode", isError: false }),
    ).toEqual({
      content: [{ type: "text", text: "Switched to search mode" }],
    });
  });

  it("flags an error reply", () => {
    expect(toStdioResult({ text: "Error: no", isError: true })).toEqual({
      content: [{ type: "text", text: "Error: no" }],
      isError: true,
    });
  });
});

describe("toBridgeResult", () => {
  it("puts a reply's text in content, as a success", () => {
    expect(
      toBridgeResult({ text: "Switched to search mode", isError: false }),
    ).toEqual({
      success: true,
      content: "Switched to search mode",
    });
  });

  it("puts an error reply's text in error, with empty content", () => {
    expect(toBridgeResult({ text: "Error: no", isError: true })).toEqual({
      success: false,
      content: "",
      error: "Error: no",
    });
  });
});

describe("comet_ask's timeout, as each adapter renders it", () => {
  it("says, over stdio, that the answer may be incomplete, wrapping the partial text", () => {
    const result = toStdioResult(rendered(TIMED_OUT));
    const text = textOf(result);

    expect(result.isError).toBeUndefined();
    expect(text).toMatch(
      /^The answer may be incomplete: this ask's 3000 ms ran out/,
    );
    expect(text).toMatch(new RegExp(wrapped("Rome was founded")));
    expect(text).toContain("comet_poll");
  });

  it("says, over the bridge, that the answer may be incomplete, wrapping the partial text, in a success's fields", () => {
    const result = toBridgeResult(rendered(TIMED_OUT));

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.content).toMatch(
      /^The answer may be incomplete: this ask's 3000 ms ran out/,
    );
    expect(result.content).toMatch(new RegExp(wrapped("Rome was founded")));
    expect(result.content).toContain("comet_poll");
  });
});

describe("comet_ask's answer, as each adapter renders it", () => {
  const MODE_LINE_THEN_ANSWER = new RegExp(
    `^${escapeRegExp(MODE_LINE)}\\n\\n${wrapped("Paris")}$`,
  );

  it("is wrapped over stdio, after the mode step's line", () => {
    const result = toStdioResult(rendered(ANSWERED));

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(textOf(result)).toMatch(MODE_LINE_THEN_ANSWER);
  });

  it("is wrapped over the bridge, after the mode step's line", () => {
    const result = toBridgeResult(rendered(ANSWERED));

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.content).toMatch(MODE_LINE_THEN_ANSWER);
  });
});

describe("comet_ask's refusal, as each adapter renders it", () => {
  it("is an error over stdio and over the bridge", () => {
    expect(toStdioResult(rendered(REFUSED))).toEqual({
      content: [{ type: "text", text: "Error: prompt cannot be empty" }],
      isError: true,
    });
    expect(toBridgeResult(rendered(REFUSED))).toEqual({
      success: false,
      content: "",
      error: "Error: prompt cannot be empty",
    });
  });
});

describe("comet_poll, as each adapter renders it", () => {
  const STILL_WORKING: PollOutcome = {
    kind: "working",
    taskId: "task_1_abc",
    progress: {
      status: "working",
      partialAnswer: "Rome was founded",
      currentStep: "Writing",
      steps: ["Searching"],
      browsingUrl: "https://history.example/rome",
    },
  };
  const COMPLETED_EARLIER: PollOutcome = {
    kind: "completed",
    answer: "Rome was founded in 753 BC.",
    secondsAgo: 2,
  };
  const PROGRESS =
    "Browsing: https://history.example/rome\nCurrent: Writing\nSteps:\n  • Searching";

  const polled = (outcome: PollOutcome) =>
    describePollOutcome(outcome, wrapUntrustedPageContent);

  it("wraps, over the bridge, the partial response and the steps of a task still working, marked partial", () => {
    const result = toBridgeResult(polled(STILL_WORKING));

    expect(result.success).toBe(true);
    expect(result.content).toMatch(/^Status: WORKING\n/);
    expect(result.content).toContain("may be incomplete");
    expect(result.content).toMatch(new RegExp(wrapped("Rome was founded")));
    expect(result.content).toMatch(new RegExp(wrapped(PROGRESS)));
  });

  it("wraps, over the bridge, the last response of a completed task", () => {
    const result = toBridgeResult(polled(COMPLETED_EARLIER));

    expect(result).toEqual({ success: true, content: expect.any(String) });
    expect(result.content).toMatch(
      new RegExp(
        `^Status: COMPLETED \\(2s ago\\)\\n\\n${wrapped("Rome was founded in 753 BC.")}$`,
      ),
    );
  });

  it("wraps the same page text over stdio", () => {
    const working = textOf(toStdioResult(polled(STILL_WORKING)));
    const completed = textOf(toStdioResult(polled(COMPLETED_EARLIER)));

    expect(working).toMatch(new RegExp(wrapped("Rome was founded")));
    expect(working).toMatch(new RegExp(wrapped(PROGRESS)));
    expect(completed).toMatch(
      new RegExp(wrapped("Rome was founded in 753 BC.")),
    );
  });
});

describe("comet_stop, as each adapter renders it", () => {
  it("says what it stopped, as a success, over stdio and over the bridge", () => {
    expect(toStdioResult(describeStopOutcome({ stopped: true }))).toEqual({
      content: [{ type: "text", text: "Agent stopped" }],
    });
    expect(toBridgeResult(describeStopOutcome({ stopped: false }))).toEqual({
      success: true,
      content: "No active agent to stop",
    });
  });
});
