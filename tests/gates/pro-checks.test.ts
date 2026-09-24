import { describe, expect, it } from "vitest";

import {
  reapplyModeBeforeAsk,
  withModeNotice,
} from "../../src/core/ask-mode.js";
import { ModeCore } from "../../src/core/mode.js";
import { answerModeTool } from "../../src/core/mode-tool.js";
import type { CallTool, ToolReply } from "../lib/no-pro-checks.mjs";
import {
  RESEARCH_PROMPT,
  RESEARCH_WORKFLOW,
  researchWorkflowHeld,
} from "../lib/pro-checks.mjs";
import { FakeModePage } from "../unit/fakes/fake-mode-page.js";

const ok = (text: string): ToolReply => ({
  content: [{ type: "text", text }],
});
const error = (text: string): ToolReply => ({
  content: [{ type: "text", text }],
  isError: true,
});

const modeReport = (current: string) =>
  [
    `Current mode: ${current}`,
    "",
    "Available modes:",
    "  search: Search",
    "  research: Deep research",
    "  labs: not available (not offered by Perplexity's current input bar)",
    "  learn: not available (not supported yet)",
    "",
  ].join("\n");

const ANSWER =
  "[BEGIN UNTRUSTED PAGE CONTENT nonce=abc]\nRESEARCHED\n[END UNTRUSTED PAGE CONTENT nonce=abc]";
const NOT_APPLIED =
  "Mode not applied: this answer may not be in research mode. Cannot switch to research mode: the page shows Search checked after selecting Deep research";

const PASSING = {
  switched: ok("Switched to research mode"),
  asked: ok(ANSWER),
  read: ok(modeReport("research")),
};

describe("researchWorkflowHeld [7.4-research-workflow]", () => {
  it("holds when research was set, the ask kept it, and the page still shows it", () => {
    expect(researchWorkflowHeld(PASSING)).toBe(true);
  });

  it("holds on an ask still in progress, when it carries no could-not-apply line", () => {
    expect(
      researchWorkflowHeld({
        ...PASSING,
        asked: ok("Task may still be in progress.\nStatus: WORKING"),
      }),
    ).toBe(true);
  });

  it("fails when the ask's result starts with the could-not-apply line", () => {
    expect(
      researchWorkflowHeld({
        ...PASSING,
        asked: ok(`${NOT_APPLIED}\n\n${ANSWER}`),
      }),
    ).toBe(false);
  });

  it("fails when the could-not-apply line is wrapped over several lines", () => {
    expect(
      researchWorkflowHeld({
        ...PASSING,
        asked: ok(`${NOT_APPLIED.replace("Cannot", "\nCannot")}\n\n${ANSWER}`),
      }),
    ).toBe(false);
  });

  it("fails when the ask is an error result", () => {
    expect(
      researchWorkflowHeld({
        ...PASSING,
        asked: error("Error: Not connected to Comet"),
      }),
    ).toBe(false);
  });

  it("fails when the page reads search afterwards, although the reply lists research", () => {
    expect(
      researchWorkflowHeld({ ...PASSING, read: ok(modeReport("search")) }),
    ).toBe(false);
  });

  it("fails when the mode read afterwards is unknown or an error", () => {
    expect(
      researchWorkflowHeld({
        ...PASSING,
        read: ok(modeReport("unknown (the mode button reads Deep research)")),
      }),
    ).toBe(false);
    expect(
      researchWorkflowHeld({ ...PASSING, read: error(modeReport("research")) }),
    ).toBe(false);
  });

  it("fails when the switch to research did not happen", () => {
    expect(
      researchWorkflowHeld({
        ...PASSING,
        switched: error(
          "Cannot switch to research mode: no mode button found on the page",
        ),
      }),
    ).toBe(false);
  });
});

describe("researchWorkflowHeld against the server's own replies", () => {
  const quote = (pageText: string) => pageText;

  it("fails on the notice comet_ask gives when the mode cannot be re-applied", async () => {
    const page = new FakeModePage();
    const core = new ModeCore(page);
    await core.switchMode("research");
    page.navigateTo("Search");
    page.selectionTakes = false;

    const notice = await reapplyModeBeforeAsk({ core, quotePage: quote });

    expect(
      researchWorkflowHeld({
        ...PASSING,
        asked: ok(withModeNotice(notice, ANSWER)),
      }),
    ).toBe(false);
  });

  it("holds on comet_mode's read of a page in Deep research", async () => {
    const page = new FakeModePage({ current: "Deep research" });
    const reply = await answerModeTool(undefined, {
      core: new ModeCore(page),
      openPerplexity: async () => {},
      quotePage: quote,
    });
    expect(reply.isError).toBeFalsy();

    expect(researchWorkflowHeld({ ...PASSING, read: ok(reply.text) })).toBe(
      true,
    );
  });
});

type Replies = Record<string, ToolReply | Error>;

const key = (name: string, args: Record<string, unknown>) =>
  `${name} ${JSON.stringify(args)}`;

const SWITCH = key("comet_mode", { mode: "research" });
const ASK = key("comet_ask", {
  prompt: RESEARCH_PROMPT,
  newChat: true,
  timeout: 180000,
});
const READ = key("comet_mode", {});
const RESTORE = key("comet_mode", { mode: "search" });

const HEALTHY: Replies = {
  [SWITCH]: PASSING.switched,
  [ASK]: PASSING.asked,
  [READ]: PASSING.read,
  [RESTORE]: ok("Switched to search mode"),
};

function fakeServer(replies: Replies) {
  const calls: string[] = [];
  const callTool: CallTool = async (name, args) => {
    const call = key(name, args);
    calls.push(call);
    const reply = replies[call];
    if (reply === undefined) throw new Error(`unexpected call ${call}`);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { callTool, calls };
}

describe("RESEARCH_WORKFLOW", () => {
  it("sets research, asks in a new chat, reads the mode, then puts search back", async () => {
    const server = fakeServer(HEALTHY);

    const outcome = await RESEARCH_WORKFLOW.probe(server.callTool);

    expect(server.calls).toEqual([SWITCH, ASK, READ, RESTORE]);
    expect(outcome.held).toBe(true);
  });

  it("fails, saying why, when the ask could not apply the mode", async () => {
    const server = fakeServer({
      ...HEALTHY,
      [ASK]: ok(`${NOT_APPLIED}\n\n${ANSWER}`),
    });

    const outcome = await RESEARCH_WORKFLOW.probe(server.callTool);

    expect(outcome.held).toBe(false);
    expect(outcome.note).toContain("Mode not applied:");
  });

  it("fails on a call that throws, and still puts search back", async () => {
    const server = fakeServer({
      ...HEALTHY,
      [ASK]: new Error("TIMEOUT after 200000ms"),
    });

    const outcome = await RESEARCH_WORKFLOW.probe(server.callTool);

    expect(outcome).toEqual({
      held: false,
      note: "TIMEOUT after 200000ms",
    });
    expect(server.calls).toEqual([SWITCH, ASK, RESTORE]);
  });

  it("says so in its note when search could not be put back", async () => {
    const server = fakeServer({
      ...HEALTHY,
      [RESTORE]: error("Cannot switch to search mode: no mode button found"),
    });

    const outcome = await RESEARCH_WORKFLOW.probe(server.callTool);

    expect(outcome.held).toBe(true);
    expect(outcome.note).toMatch(
      / \/ search not restored: Cannot switch to search mode: no mode button found$/,
    );
  });
});
