import { describe, expect, it } from "vitest";

import {
  reapplyModeBeforeAsk,
  withModeNotice,
} from "../../src/core/ask-mode.js";
import { ModeCore } from "../../src/core/mode.js";
import { answerModeTool } from "../../src/core/mode-tool.js";
import { wrapUntrustedPageContent } from "../../src/untrusted.js";
import {
  batteryPassed,
  PRO_KNOWN_FAILURES,
  type ScoredCheck,
  summaryLine,
} from "../lib/battery-score.mjs";
import type { DebugPort, ToolReply } from "../lib/no-pro-checks.mjs";
import {
  agentOpenedTab,
  agentStopped,
  answered,
  answerNames,
  answerNamesWithoutEcho,
  contextReset,
  emptyPromptRefused,
  fileNotFound,
  followUpAnswered,
  pollAfterStop,
  pollIdle,
  RESEARCH_PROMPT,
  RESEARCH_WORKFLOW,
  researchWorkflowHeld,
  runProBattery,
  selectorNotFound,
  siteTabClosed,
  switchedToSite,
  tabsKept,
  timeoutStated,
  trendingRepoNamed,
  UPLOAD_TEST_FILE,
  wholeAnswer,
} from "../lib/pro-checks.mjs";
import { FakeModePage } from "../unit/fakes/fake-mode-page.js";
import {
  error,
  fakeServer,
  key,
  modeReport,
  ok,
  type Replies,
} from "./support/battery-replies.js";
import { declaredTools, schemaViolations } from "./support/declared-tools.js";

// The Pro checks' conditions. Each holds on the reply the check expects and
// fails on the replies that used to pass it: a login page, an error, a
// timeout's partial text, or the previous question's answer.

/** An answer as the server returns it: page text in the UNTRUSTED markers. */
const answer = (pageText: string) => ok(wrapUntrustedPageContent(pageText));

/** Today's result when the ask runs out of time before the page answers. */
const STILL_IN_PROGRESS = ok(
  "Task may still be in progress (max timeout reached).\nStatus: WORKING\n\nUse comet_poll to check progress or comet_stop to cancel.",
);

/** The timeout result principle 7 asks for: partial text, said to be partial. */
const MAY_BE_INCOMPLETE = ok(
  `The answer may be incomplete: the ask ran out of time.\n\n${wrapUntrustedPageContent("Rome was founded")}\n\nUse comet_poll to follow it.`,
);

const LOGIN_PAGE = answer("Sign in or create an account to continue");

describe("answered", () => {
  it("holds on an answer", () => {
    expect(answered(answer("Paris"))).toBe(true);
  });

  it("fails on an error result", () => {
    expect(answered(error("Error: Not connected to Comet"))).toBe(false);
  });

  it("fails on a result that says the task may still be in progress", () => {
    expect(answered(STILL_IN_PROGRESS)).toBe(false);
  });

  it("fails on a result that says the answer may be incomplete", () => {
    expect(answered(MAY_BE_INCOMPLETE)).toBe(false);
  });
});

describe("answerNames [2.1] [3.1]", () => {
  it("holds when the answer names the word, in any case", () => {
    expect(answerNames(answer("VERIFIED"), "VERIFIED")).toBe(true);
    expect(answerNames(answer("paris."), "Paris")).toBe(true);
    expect(
      answerNames(answer("The heading is Example Domain."), "Example Domain"),
    ).toBe(true);
  });

  it("fails on a login page", () => {
    expect(answerNames(LOGIN_PAGE, "VERIFIED")).toBe(false);
  });

  it("fails on any other text", () => {
    expect(answerNames(answer("I can certainly help you"), "Paris")).toBe(
      false,
    );
  });

  it("fails when the word is only part of another", () => {
    expect(answerNames(answer("UNVERIFIED"), "VERIFIED")).toBe(false);
  });

  it("fails on an error result that names the word", () => {
    expect(
      answerNames(
        error("Error: Prompt text not found in input: Artemis"),
        "Artemis",
      ),
    ).toBe(false);
  });

  it("fails on a result still in progress, whatever its page text", () => {
    expect(
      answerNames(
        ok(
          `Task may still be in progress (max timeout reached).\n${wrapUntrustedPageContent("Current: Reply with exactly one word: VERIFIED")}`,
        ),
        "VERIFIED",
      ),
    ).toBe(false);
  });
});

describe("answerNamesWithoutEcho [1.5] [2.5]", () => {
  const SESSION_PROMPT = "Reply with exactly one word: VERIFIED";
  const CONTEXT_PROMPT = "What is the project name?";

  it("holds when the answer names the word and does not read the prompt back", () => {
    expect(
      answerNamesWithoutEcho(answer("VERIFIED"), "VERIFIED", SESSION_PROMPT),
    ).toBe(true);
    expect(
      answerNamesWithoutEcho(
        answer("The project is Artemis."),
        "Artemis",
        CONTEXT_PROMPT,
      ),
    ).toBe(true);
  });

  it("fails on the prompt read back, which names the word itself", () => {
    expect(
      answerNamesWithoutEcho(
        answer(SESSION_PROMPT),
        "VERIFIED",
        SESSION_PROMPT,
      ),
    ).toBe(false);
  });

  it("fails on the question as the thread shows it, context first", () => {
    expect(
      answerNamesWithoutEcho(
        answer(
          `Context for this task:\nProject name: Artemis\n\nBased on the above context, ${CONTEXT_PROMPT}`,
        ),
        "Artemis",
        CONTEXT_PROMPT,
      ),
    ).toBe(false);
  });

  it("fails on the prompt read back across lines or in another case", () => {
    expect(
      answerNamesWithoutEcho(
        answer("reply with exactly\n  one word: verified"),
        "VERIFIED",
        SESSION_PROMPT,
      ),
    ).toBe(false);
  });

  it("fails where answerNames fails", () => {
    expect(answerNamesWithoutEcho(LOGIN_PAGE, "VERIFIED", SESSION_PROMPT)).toBe(
      false,
    );
  });
});

describe("followUpAnswered [2.2]", () => {
  const FIRST = answer("NOTED");

  it("holds when the follow-up answers with the number the first turn gave", () => {
    expect(followUpAnswered({ first: FIRST, followUp: answer("9473") })).toBe(
      true,
    );
  });

  it("fails when the follow-up returns the previous turn's answer", () => {
    expect(followUpAnswered({ first: FIRST, followUp: answer("NOTED") })).toBe(
      false,
    );
  });

  it("fails when the follow-up runs both turns together", () => {
    expect(
      followUpAnswered({ first: FIRST, followUp: answer("NOTED\n\n9473") }),
    ).toBe(false);
  });

  it("fails when the follow-up does not name the number", () => {
    expect(
      followUpAnswered({
        first: FIRST,
        followUp: answer("You did not ask me to remember a number."),
      }),
    ).toBe(false);
  });

  it("fails when the first turn was not answered", () => {
    expect(
      followUpAnswered({ first: STILL_IN_PROGRESS, followUp: answer("9473") }),
    ).toBe(false);
  });
});

describe("contextReset [2.3]", () => {
  const FIRST = answer("I will remember 9473.");

  it("holds when the new chat's answer does not know the number", () => {
    expect(
      contextReset({
        first: FIRST,
        fresh: answer("You have not asked me to remember a number."),
      }),
    ).toBe(true);
  });

  it("fails when the new chat still knows the number", () => {
    expect(contextReset({ first: FIRST, fresh: answer("9473") })).toBe(false);
  });

  it("fails when the new chat's ask is an error", () => {
    expect(
      contextReset({
        first: FIRST,
        fresh: error("Error: Prompt text not found in input"),
      }),
    ).toBe(false);
  });

  it("fails when the new chat's ask ran out of time", () => {
    expect(contextReset({ first: FIRST, fresh: STILL_IN_PROGRESS })).toBe(
      false,
    );
  });

  it("fails when the first ask is an error, so no number was given", () => {
    expect(
      contextReset({
        first: error("Error: Not connected to Comet"),
        fresh: answer("You have not asked me to remember a number."),
      }),
    ).toBe(false);
  });
});

describe("timeoutStated [2.4]", () => {
  it("holds when the ask returns in time and says the answer may be incomplete", () => {
    expect(timeoutStated({ reply: MAY_BE_INCOMPLETE, elapsedMs: 4200 })).toBe(
      true,
    );
  });

  it("fails on partial text returned as if it were the answer", () => {
    expect(
      timeoutStated({
        reply: answer("Rome was founded, according to legend, in 753 BC."),
        elapsedMs: 4200,
      }),
    ).toBe(false);
  });

  it("fails on today's in-progress result, which does not say the answer may be incomplete", () => {
    expect(timeoutStated({ reply: STILL_IN_PROGRESS, elapsedMs: 4200 })).toBe(
      false,
    );
  });

  it("fails when the result does not name comet_poll to follow the answer", () => {
    expect(
      timeoutStated({
        reply: ok("The answer may be incomplete."),
        elapsedMs: 4200,
      }),
    ).toBe(false);
  });

  it("fails when the ask took too long, whatever it says", () => {
    expect(timeoutStated({ reply: MAY_BE_INCOMPLETE, elapsedMs: 9000 })).toBe(
      false,
    );
  });

  it("fails on an error result", () => {
    expect(
      timeoutStated({
        reply: error(
          "Error: the answer may be incomplete; use comet_poll to follow it",
        ),
        elapsedMs: 4200,
      }),
    ).toBe(false);
  });
});

describe("wholeAnswer [2.6-whole-answer]", () => {
  const WHOLE = answer(
    "ALPHA opens the first paragraph.\n\nBRAVO opens the second.\n\nCHARLIE opens the third.",
  );

  it("holds when every paragraph comes back, in order", () => {
    expect(wholeAnswer(WHOLE)).toBe(true);
  });

  it("fails when only the last paragraph comes back", () => {
    expect(wholeAnswer(answer("CHARLIE opens the third."))).toBe(false);
  });

  it("holds when a paragraph's opener follows spaces at the line's start", () => {
    expect(
      wholeAnswer(answer("  ALPHA one.\n\n  BRAVO two.\n\n  CHARLIE three.")),
    ).toBe(true);
  });

  it("fails on the prompt read back, which names the openers in order", () => {
    expect(
      wholeAnswer(
        answer(
          "Write three short paragraphs about the sea. Start the first with the word ALPHA, the second with the word BRAVO and the third with the word CHARLIE.",
        ),
      ),
    ).toBe(false);
  });

  it("fails when an opener only comes mid-line", () => {
    expect(
      wholeAnswer(answer("ALPHA one.\n\nThen BRAVO two.\n\nCHARLIE three.")),
    ).toBe(false);
  });

  it("fails when the paragraphs come back out of order", () => {
    expect(
      wholeAnswer(answer("CHARLIE opens.\n\nALPHA opens.\n\nBRAVO opens.")),
    ).toBe(false);
  });

  it("fails when the answer is still in progress", () => {
    expect(
      wholeAnswer(
        ok(
          `Task may still be in progress (max timeout reached).\n${wrapUntrustedPageContent("ALPHA BRAVO CHARLIE")}`,
        ),
      ),
    ).toBe(false);
  });
});

/** `comet_tabs`' listing of the given tabs, as `getTabSummary` writes it. */
const tabListing = (...tabs: Array<[purpose: string, url: string]>) =>
  tabs.length === 0
    ? ok("No browsing tabs open")
    : ok(
        [
          `${tabs.length} browsing tab(s) open:`,
          ...tabs.flatMap(([purpose, url]) => [
            `  • ${purpose}: ${new URL(url).hostname}`,
            `    URL: ${url}`,
          ]),
        ].join("\n"),
      );

const USER_TAB: [string, string] = ["AGENT-BROWSING", "https://news.example/a"];
const AGENT_TAB: [string, string] = ["AGENT-BROWSING", "https://example.org/"];

describe("agentOpenedTab [3.2-agent-tab]", () => {
  it("holds when a tab on the site appears after the ask", () => {
    expect(
      agentOpenedTab({
        before: tabListing(USER_TAB),
        after: tabListing(USER_TAB, AGENT_TAB),
      }),
    ).toBe(true);
  });

  it("holds on a subdomain of the site", () => {
    expect(
      agentOpenedTab({
        before: tabListing(),
        after: tabListing(["AGENT-BROWSING", "https://www.example.org/"]),
      }),
    ).toBe(true);
  });

  it("fails when no tab was opened", () => {
    expect(agentOpenedTab({ before: tabListing(), after: tabListing() })).toBe(
      false,
    );
  });

  it("fails when the site's tab was already open before the ask", () => {
    expect(
      agentOpenedTab({
        before: tabListing(AGENT_TAB),
        after: tabListing(AGENT_TAB),
      }),
    ).toBe(false);
  });

  it("fails on a site whose name only ends like the one asked for", () => {
    expect(
      agentOpenedTab({
        before: tabListing(),
        after: tabListing(["AGENT-BROWSING", "https://notexample.org/"]),
      }),
    ).toBe(false);
  });

  it("fails when a listing is an error", () => {
    expect(
      agentOpenedTab({
        before: tabListing(),
        after: error(tabListing(AGENT_TAB).content?.[0]?.text ?? ""),
      }),
    ).toBe(false);
  });
});

describe("tabsKept [3.3-tabs-kept]", () => {
  it("holds when the agent opened its tab and every tab open before is still open", () => {
    expect(
      tabsKept({
        before: tabListing(USER_TAB),
        after: tabListing(USER_TAB, AGENT_TAB),
      }),
    ).toBe(true);
  });

  it("fails when a tab open before the ask is gone", () => {
    expect(
      tabsKept({
        before: tabListing(USER_TAB, ["AGENT-BROWSING", "https://b.example/"]),
        after: tabListing(USER_TAB, AGENT_TAB),
      }),
    ).toBe(false);
  });

  it("fails when a tab open before the ask was taken to another page", () => {
    expect(
      tabsKept({
        before: tabListing(USER_TAB),
        after: tabListing(AGENT_TAB, [
          "AGENT-BROWSING",
          "https://news.example/b",
        ]),
      }),
    ).toBe(false);
  });

  it("fails when the agent opened no tab, since nothing was tested", () => {
    expect(
      tabsKept({ before: tabListing(USER_TAB), after: tabListing(USER_TAB) }),
    ).toBe(false);
  });
});

describe("trendingRepoNamed [3.4]", () => {
  it("holds on a repository's name and its star count", () => {
    expect(
      trendingRepoNamed(
        answer("The top repository today is octo/widgets, with 12,345 stars."),
      ),
    ).toBe(true);
    expect(trendingRepoNamed(answer("octo/widgets — stars: 4.2k"))).toBe(true);
  });

  it("fails on the previous question's answer", () => {
    expect(
      trendingRepoNamed(
        answer("The page heading (title) of example.org is Example Domain."),
      ),
    ).toBe(false);
  });

  it("fails on a repository without its star count", () => {
    expect(
      trendingRepoNamed(answer("The top repository is octo/widgets.")),
    ).toBe(false);
  });

  it("fails on an answer still in progress", () => {
    expect(
      trendingRepoNamed(
        ok(
          `Task may still be in progress (max timeout reached).\n${wrapUntrustedPageContent("octo/widgets, 12 stars")}`,
        ),
      ),
    ).toBe(false);
  });
});

describe("pollIdle [4.1]", () => {
  it("holds on an idle poll or on the last task completed", () => {
    expect(
      pollIdle(
        ok("Status: IDLE\nNo active task. Use comet_ask to start a new task."),
      ),
    ).toBe(true);
    expect(
      pollIdle(
        ok(`Status: COMPLETED (0s ago)\n\n${wrapUntrustedPageContent("x")}`),
      ),
    ).toBe(true);
  });

  it("fails on a task still working", () => {
    expect(pollIdle(ok("Status: WORKING\nTask: task-1"))).toBe(false);
  });

  it("fails on page text with no status", () => {
    expect(pollIdle(answer("Status: IDLE"))).toBe(false);
  });

  it("fails on an error result", () => {
    expect(pollIdle(error("Status: IDLE"))).toBe(false);
  });
});

describe("agentStopped [4.3]", () => {
  it("holds when the stop says it stopped the agent", () => {
    expect(agentStopped(ok("Agent stopped"))).toBe(true);
  });

  it("fails when there was nothing to stop", () => {
    expect(agentStopped(ok("No active agent to stop"))).toBe(false);
  });

  it("fails on an error result", () => {
    expect(agentStopped(error("Agent stopped"))).toBe(false);
  });
});

describe("pollAfterStop [4.3b]", () => {
  it("holds when the poll reports the task stopped, or no task", () => {
    expect(pollAfterStop(ok("Status: STOPPED"))).toBe(true);
    expect(
      pollAfterStop(
        ok("Status: IDLE\nNo active task. Use comet_ask to start a new task."),
      ),
    ).toBe(true);
  });

  it("fails when the poll still returns the stopped task's answer", () => {
    expect(pollAfterStop(answer("The featured article is about"))).toBe(false);
  });

  it("fails when the poll reports the task working or completed", () => {
    expect(pollAfterStop(ok("Status: WORKING\nTask: task-1"))).toBe(false);
    expect(pollAfterStop(ok("Status: COMPLETED (0s ago)"))).toBe(false);
  });
});

describe("switchedToSite [6.3]", () => {
  it("holds when the switch names the site's tab", () => {
    expect(
      switchedToSite(
        ok("Switched to example.com (https://example.com/)"),
        "example.com",
      ),
    ).toBe(true);
    expect(
      switchedToSite(
        ok("Switched to www.example.com (https://www.example.com/)"),
        "example.com",
      ),
    ).toBe(true);
  });

  it("fails when no tab is found for the site", () => {
    expect(
      switchedToSite(
        error("No tab found for the specified domain"),
        "example.com",
      ),
    ).toBe(false);
  });

  it("fails when it switched to another site", () => {
    expect(
      switchedToSite(
        ok("Switched to notexample.com (https://notexample.com/)"),
        "example.com",
      ),
    ).toBe(false);
  });
});

describe("siteTabClosed [6.4]", () => {
  it("holds when the site's tab was closed", () => {
    expect(siteTabClosed(ok("Closed example.com"), "example.com")).toBe(true);
  });

  it("holds on the refusal to close the only browsing tab", () => {
    expect(
      siteTabClosed(
        error(
          "Cannot close - this is the only browsing tab. Comet needs at least one external tab open.",
        ),
        "example.com",
      ),
    ).toBe(true);
  });

  it("fails when no tab is found for the site", () => {
    expect(
      siteTabClosed(
        error("No tab found for the specified domain"),
        "example.com",
      ),
    ).toBe(false);
  });

  it("fails when the close failed", () => {
    expect(siteTabClosed(ok("Failed to close tab"), "example.com")).toBe(false);
  });

  it("fails on the refusal text when it is not an error result", () => {
    expect(
      siteTabClosed(
        ok("Cannot close - this is the only browsing tab."),
        "example.com",
      ),
    ).toBe(false);
  });
});

describe("selectorNotFound [8.3]", () => {
  const SELECTOR = "#does-not-exist-xyzabc";

  it("holds on the error naming the selector", () => {
    expect(
      selectorNotFound(
        error(
          `No element found matching selector: ${SELECTOR}\n\nAvailable file inputs:\n  1. input[type=file]`,
        ),
        SELECTOR,
      ),
    ).toBe(true);
  });

  it("fails when the upload is reported as done", () => {
    expect(selectorNotFound(ok("File uploaded successfully"), SELECTOR)).toBe(
      false,
    );
  });

  it("fails on another error", () => {
    expect(
      selectorNotFound(error("Error: File not found: /tmp/x"), SELECTOR),
    ).toBe(false);
  });
});

describe("fileNotFound [8.4]", () => {
  const PATH = "/tmp/file-that-does-not-exist-xyzabc.txt";

  it("holds on the error naming the missing file", () => {
    expect(fileNotFound(error(`Error: File not found: ${PATH}`), PATH)).toBe(
      true,
    );
  });

  it("fails when the upload is reported as done", () => {
    expect(fileNotFound(ok("File uploaded successfully"), PATH)).toBe(false);
  });

  it("fails on another error", () => {
    expect(fileNotFound(error("Error: Not connected to Comet"), PATH)).toBe(
      false,
    );
  });
});

describe("emptyPromptRefused [9.2]", () => {
  it("holds on the refusal of an empty prompt", () => {
    expect(emptyPromptRefused(ok("Error: prompt cannot be empty"))).toBe(true);
    expect(emptyPromptRefused(error("Error: prompt cannot be empty"))).toBe(
      true,
    );
  });

  it("fails when the empty prompt is sent and answered", () => {
    expect(emptyPromptRefused(answer("How can I help you today?"))).toBe(false);
  });

  it("fails on another error", () => {
    expect(emptyPromptRefused(error("Error: Not connected to Comet"))).toBe(
      false,
    );
  });
});

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

// The Pro battery as a whole, against a stand-in server: which tools it
// calls, with which arguments, in which order, and how it scores what
// comes back.

const LISTENING: DebugPort = { port: 9223, answers: async () => true };
const SILENT: DebugPort = { port: 9223, answers: async () => false };
const noWait = async () => {};

const ANSWER_ASK = 60000;
const BROWSING_ASK = 90000;
const LONG_ASK = 120000;
const MISSING_FILE = "/tmp/file-that-does-not-exist-xyzabc.txt";
const MISSING_SELECTOR = "#does-not-exist-xyzabc";

const ask = (prompt: string, timeout: number, more = {}) =>
  key("comet_ask", { prompt, ...more, timeout });

const CALLS = {
  connect: key("comet_connect", {}),
  session: ask("Reply with exactly one word: VERIFIED", ANSWER_ASK),
  capital: ask("What is the capital of France? Reply in one word.", ANSWER_ASK),
  remember: ask(
    "Remember the number 9473. Reply with exactly one word: NOTED",
    ANSWER_ASK,
    { newChat: true },
  ),
  recall: ask(
    "What number did I ask you to remember? Reply with the number only.",
    ANSWER_ASK,
  ),
  rememberAgain: ask("Remember the number 9473.", ANSWER_ASK, {
    newChat: true,
  }),
  recallInNewChat: ask("What number did I ask you to remember?", ANSWER_ASK, {
    newChat: true,
  }),
  essay: ask("Write a 10000 word essay on the history of Rome.", 3000),
  context: ask("What is the project name?", ANSWER_ASK, {
    context: "Project name: Artemis",
  }),
  paragraphs: ask(
    "Write three short paragraphs about the sea. Start the first with the word ALPHA, the second with the word BRAVO and the third with the word CHARLIE.",
    ANSWER_ASK,
  ),
  heading: ask("Go to example.com and tell me the page heading.", BROWSING_ASK),
  tabs: key("comet_tabs", {}),
  agentTab: ask(
    "Go to example.org and tell me the page heading.",
    BROWSING_ASK,
  ),
  trending: ask(
    "Go to github.com/trending, find the top-ranked repository today, and tell me its name and star count.",
    LONG_ASK,
  ),
  poll: key("comet_poll", {}),
  slowTask: ask(
    "Go to wikipedia.org and summarize the entire featured article in extreme detail.",
    LONG_ASK,
  ),
  stop: key("comet_stop", {}),
  screenshot: key("comet_screenshot", {}),
  visit: ask("Go to example.com.", BROWSING_ASK),
  switchTab: key("comet_tabs", { action: "switch", domain: "example.com" }),
  closeTab: key("comet_tabs", { action: "close", domain: "example.com" }),
  readMode: key("comet_mode", {}),
  research: key("comet_mode", { mode: "research" }),
  labs: key("comet_mode", { mode: "labs" }),
  learn: key("comet_mode", { mode: "learn" }),
  search: key("comet_mode", { mode: "search" }),
  researchAsk: ASK,
  wrongSelector: key("comet_upload", {
    filePath: UPLOAD_TEST_FILE,
    selector: MISSING_SELECTOR,
  }),
  missingFile: key("comet_upload", { filePath: MISSING_FILE }),
  emptyPrompt: key("comet_ask", { prompt: "" }),
  invalidMode: key("comet_mode", { mode: "invalid_mode_xyz" }),
};

const IMAGE: ToolReply = {
  content: [{ type: "image", data: "iVBORw0KGgo", mimeType: "image/png" }],
};
const NO_TABS = ok("No browsing tabs open");
const COMPLETED = ok(
  `Status: COMPLETED (0s ago)\n\n${wrapUntrustedPageContent("octo/widgets")}`,
);

/**
 * Comet as the Pro runs of 2026-09-24 found it, each reply in the shape
 * the server gives today: the checks the known-failures list names fail,
 * and every other check holds.
 */
const TODAY: Replies = {
  [CALLS.connect]: ok("Comet already running with debug port: Chrome/152"),
  [CALLS.session]: STILL_IN_PROGRESS,
  [CALLS.capital]: STILL_IN_PROGRESS,
  [CALLS.remember]: STILL_IN_PROGRESS,
  [CALLS.recall]: answer("NOTED"),
  [CALLS.rememberAgain]: answer("Got it: 9473."),
  [CALLS.recallInNewChat]: answer("You have not asked me to remember one."),
  [CALLS.essay]: answer("Rome was founded, according to legend, in 753 BC."),
  [CALLS.context]: error(
    "Error: Prompt text not found in input - typing may have failed",
  ),
  [CALLS.paragraphs]: answer("CHARLIE closes the three paragraphs."),
  [CALLS.heading]: answer("I can certainly help you with an overview."),
  [CALLS.tabs]: [NO_TABS, NO_TABS, NO_TABS],
  [CALLS.agentTab]: answer("The heading of example.org is Example Domain."),
  [CALLS.trending]: answer("The heading of example.org is Example Domain."),
  [CALLS.poll]: [COMPLETED, answer("The featured article is about")],
  [CALLS.slowTask]: STILL_IN_PROGRESS,
  [CALLS.stop]: ok("Agent stopped"),
  [CALLS.screenshot]: IMAGE,
  [CALLS.visit]: [answer("Done."), answer("Done.")],
  [CALLS.switchTab]: error("No tab found for the specified domain"),
  [CALLS.closeTab]: error(
    "Cannot close - this is the only browsing tab. Comet needs at least one external tab open.",
  ),
  [CALLS.readMode]: [
    ok(modeReport("search")),
    ok(modeReport("research")),
    ok(modeReport("search")),
  ],
  [CALLS.research]: ok("Switched to research mode"),
  [CALLS.labs]: error(
    "Cannot switch to labs mode: not offered by Perplexity's current input bar",
  ),
  [CALLS.learn]: error("Cannot switch to learn mode: not supported yet"),
  [CALLS.search]: [
    ok("Switched to search mode"),
    ok("Switched to search mode"),
  ],
  [CALLS.researchAsk]: ok(ANSWER),
  [CALLS.wrongSelector]: error(
    `No element found matching selector: ${MISSING_SELECTOR}`,
  ),
  [CALLS.missingFile]: error(`Error: File not found: ${MISSING_FILE}`),
  [CALLS.emptyPrompt]: ok("Error: prompt cannot be empty"),
  [CALLS.invalidMode]: error(
    "Invalid mode: invalid_mode_xyz. Use: search, research, labs, learn",
  ),
};

const AGENT_TABS = tabListing(AGENT_TAB);

/** Comet once every fix lands: every check's condition holds. */
const FIXED: Replies = {
  ...TODAY,
  [CALLS.session]: answer("VERIFIED"),
  [CALLS.capital]: answer("Paris"),
  [CALLS.remember]: answer("NOTED"),
  [CALLS.recall]: answer("9473"),
  [CALLS.essay]: MAY_BE_INCOMPLETE,
  [CALLS.context]: answer("The project is Artemis."),
  [CALLS.paragraphs]: answer("ALPHA one.\n\nBRAVO two.\n\nCHARLIE three."),
  [CALLS.heading]: answer("Example Domain"),
  [CALLS.tabs]: [NO_TABS, AGENT_TABS, AGENT_TABS],
  [CALLS.trending]: answer("octo/widgets, with 12,345 stars"),
  [CALLS.poll]: [COMPLETED, ok("Status: STOPPED")],
  [CALLS.switchTab]: ok("Switched to example.com (https://example.com/)"),
  [CALLS.learn]: ok("Switched to learn mode"),
};

const ORDER = [
  "1.2",
  "1.5",
  "2.1",
  "2.2",
  "2.3",
  "2.4",
  "2.5",
  "2.6-whole-answer",
  "3.1",
  "3.2-agent-tab",
  "3.3-tabs-kept",
  "3.4",
  "4.1",
  "4.3",
  "4.3b",
  "5.1",
  "5.2",
  "6.1",
  "6.3",
  "6.4",
  "7.1",
  "7.2-research",
  "7.2-labs",
  "7.2-learn",
  "7.2-search",
  "7.4-research-workflow",
  "8.3",
  "8.4",
  "9.2",
  "9.4",
];

const byId = (checks: readonly ScoredCheck[], id: string) =>
  checks.find((check) => check.id === id);

const verdicts = (checks: readonly ScoredCheck[]) =>
  Object.fromEntries(checks.map((check) => [check.id, check.verdict]));

describe("runProBattery", () => {
  it("scores today's Comet as passed and known, and passes", async () => {
    const checks = await runProBattery(
      fakeServer(TODAY).callTool,
      LISTENING,
      undefined,
      noWait,
    );
    expect(summaryLine(checks)).toBe("Results: 17 passed, 0 failed, 13 known");
    expect(batteryPassed(checks)).toBe(true);
    expect(
      checks
        .filter((check) => check.verdict === "KNOWN")
        .map((check) => check.id),
    ).toEqual(PRO_KNOWN_FAILURES.map((entry) => entry.id));
  });

  it("scores every known failure as an unexpected pass once its fix lands", async () => {
    const checks = await runProBattery(
      fakeServer(FIXED).callTool,
      LISTENING,
      undefined,
      noWait,
    );
    const listed = new Set(PRO_KNOWN_FAILURES.map((entry) => entry.id));
    for (const check of checks) {
      expect([check.id, check.verdict]).toEqual([
        check.id,
        listed.has(check.id) ? "UNEXPECTED PASS" : "PASS",
      ]);
    }
    expect(batteryPassed(checks)).toBe(false);
  });

  it("reports each check as it is scored, in order", async () => {
    const reported: string[] = [];
    await runProBattery(
      fakeServer(TODAY).callTool,
      LISTENING,
      (check) => reported.push(check.id),
      noWait,
    );
    expect(reported).toEqual(ORDER);
  });

  it("makes these tool calls, in this order", async () => {
    const server = fakeServer(TODAY);
    await runProBattery(server.callTool, LISTENING, undefined, noWait);
    expect(server.calls).toEqual([
      CALLS.connect,
      CALLS.session,
      CALLS.capital,
      CALLS.remember,
      CALLS.recall,
      CALLS.rememberAgain,
      CALLS.recallInNewChat,
      CALLS.essay,
      CALLS.context,
      CALLS.paragraphs,
      CALLS.heading,
      CALLS.tabs,
      CALLS.agentTab,
      CALLS.tabs,
      CALLS.trending,
      CALLS.poll,
      CALLS.slowTask,
      CALLS.stop,
      CALLS.poll,
      CALLS.screenshot,
      CALLS.visit,
      CALLS.screenshot,
      CALLS.tabs,
      CALLS.visit,
      CALLS.switchTab,
      CALLS.closeTab,
      CALLS.readMode,
      CALLS.research,
      CALLS.labs,
      CALLS.learn,
      CALLS.search,
      CALLS.research,
      CALLS.researchAsk,
      CALLS.readMode,
      CALLS.search,
      CALLS.wrongSelector,
      CALLS.missingFile,
      CALLS.emptyPrompt,
      CALLS.invalidMode,
      CALLS.readMode,
    ]);
  });

  it("passes no tool a parameter its input schema does not declare, and no value it does not allow but [9.4]'s", async () => {
    const tools = declaredTools();
    for (const replies of [TODAY, FIXED]) {
      const server = fakeServer(replies);
      await runProBattery(server.callTool, LISTENING, undefined, noWait);
      const violations = server.calls.flatMap((call) => {
        const space = call.indexOf(" ");
        return schemaViolations(
          tools,
          call.slice(0, space),
          JSON.parse(call.slice(space + 1)),
        );
      });
      // [9.4] sends a mode the schema does not allow, to see it refused.
      expect(violations).toEqual([
        "comet_mode's mode does not allow invalid_mode_xyz",
      ]);
    }
  });

  it("judges each check on its own condition, so a reply that used to pass fails", async () => {
    const checks = await runProBattery(
      fakeServer({
        ...FIXED,
        [CALLS.session]: LOGIN_PAGE,
        [CALLS.recall]: answer("NOTED\n\n9473"),
        [CALLS.recallInNewChat]: error("Error: Not connected to Comet"),
        [CALLS.poll]: [ok("Status: WORKING"), answer("The article")],
        [CALLS.stop]: ok("No active agent to stop"),
        [CALLS.closeTab]: error("No tab found for the specified domain"),
        [CALLS.wrongSelector]: ok("File uploaded successfully"),
        [CALLS.missingFile]: error("Error: Not connected to Comet"),
        [CALLS.emptyPrompt]: answer("How can I help you today?"),
      }).callTool,
      LISTENING,
      undefined,
      noWait,
    );
    expect(verdicts(checks)).toMatchObject({
      "1.5": "KNOWN",
      "2.2": "KNOWN",
      "2.3": "FAIL",
      "4.1": "FAIL",
      "4.3": "FAIL",
      "4.3b": "KNOWN",
      "6.4": "FAIL",
      "8.3": "FAIL",
      "8.4": "FAIL",
      "9.2": "FAIL",
    });
  });

  it("scores a prompt read back as a failure, never as an unexpected pass", async () => {
    const checks = await runProBattery(
      fakeServer({
        ...FIXED,
        [CALLS.session]: answer("Reply with exactly one word: VERIFIED"),
        [CALLS.context]: answer(
          "Context for this task:\nProject name: Artemis\n\nBased on the above context, What is the project name?",
        ),
        [CALLS.paragraphs]: answer(
          "Write three short paragraphs about the sea. Start the first with the word ALPHA, the second with the word BRAVO and the third with the word CHARLIE.",
        ),
      }).callTool,
      LISTENING,
      undefined,
      noWait,
    );
    expect(verdicts(checks)).toMatchObject({
      "1.5": "KNOWN",
      "2.5": "KNOWN",
      "2.6-whole-answer": "KNOWN",
    });
  });

  it("scores [7.2-learn] with the no-pro battery's predicate, as known", async () => {
    const checks = await runProBattery(
      fakeServer(TODAY).callTool,
      LISTENING,
      undefined,
      noWait,
    );
    expect(byId(checks, "7.2-learn")).toMatchObject({
      verdict: "KNOWN",
      note: "Cannot switch to learn mode: not supported yet",
    });
  });

  it("waits before stopping the slow task, and again before polling", async () => {
    const server = fakeServer(TODAY);
    const waits: Array<[number, string]> = [];
    await runProBattery(server.callTool, LISTENING, undefined, async (ms) => {
      waits.push([ms, server.calls.at(-1) ?? ""]);
    });
    expect(waits).toEqual([
      [3000, CALLS.slowTask],
      [1000, CALLS.stop],
    ]);
  });

  it("fails [4.3] and [4.3b] with the stop's error when the stop throws, and still ends the slow task", async () => {
    let slowTaskEnded = false;
    const server = fakeServer({
      ...TODAY,
      [CALLS.stop]: new Error("TIMEOUT after 10000ms"),
    });
    const callTool: typeof server.callTool = async (name, args, limit) => {
      const reply = await server.callTool(name, args, limit);
      if (key(name, args) === CALLS.slowTask) slowTaskEnded = true;
      return reply;
    };
    const checks = await runProBattery(callTool, LISTENING, undefined, noWait);
    expect(byId(checks, "4.3")).toMatchObject({
      verdict: "FAIL",
      note: "TIMEOUT after 10000ms",
    });
    expect(byId(checks, "4.3b")).toMatchObject({
      verdict: "KNOWN",
      note: "TIMEOUT after 10000ms",
    });
    expect(slowTaskEnded).toBe(true);
    expect(server.calls.filter((call) => call === CALLS.poll)).toHaveLength(1);
  });

  it("fails [5.1] and [5.2] on an error screenshot, with the no-pro battery's condition", async () => {
    const checks = await runProBattery(
      fakeServer({
        ...TODAY,
        [CALLS.screenshot]: error(
          `Error: Screenshot failed: ${"the page did not answer. ".repeat(8)}`,
        ),
      }).callTool,
      LISTENING,
      undefined,
      noWait,
    );
    expect(byId(checks, "5.1")?.verdict).toBe("FAIL");
    expect(byId(checks, "5.2")?.verdict).toBe("FAIL");
  });

  it("fails a check whose call throws, with the error as its note", async () => {
    const checks = await runProBattery(
      fakeServer({
        ...TODAY,
        [CALLS.screenshot]: new Error("MCP error -32000: Connection closed"),
      }).callTool,
      LISTENING,
      undefined,
      noWait,
    );
    expect(byId(checks, "5.1")).toMatchObject({
      verdict: "FAIL",
      note: "MCP error -32000: Connection closed",
    });
  });

  describe("when connect fails", () => {
    it("scores [1.2] alone, and calls no other tool", async () => {
      const server = fakeServer({
        [CALLS.connect]: error("Error: Timeout waiting for Comet"),
      });
      const checks = await runProBattery(
        server.callTool,
        LISTENING,
        undefined,
        noWait,
      );
      expect(checks).toEqual([
        expect.objectContaining({ id: "1.2", verdict: "FAIL" }),
      ]);
      expect(server.calls).toEqual([CALLS.connect]);
      expect(batteryPassed(checks)).toBe(false);
    });
  });

  describe("when Comet does not answer on its debug port", () => {
    it("fails at [1.2] naming the port, without calling any tool", async () => {
      const server = fakeServer({});
      const checks = await runProBattery(
        server.callTool,
        SILENT,
        undefined,
        noWait,
      );
      expect(checks).toEqual([
        {
          id: "1.2",
          verdict: "FAIL",
          note: "Comet is not running with its debug port on 9223",
        },
      ]);
      expect(server.calls).toEqual([]);
    });
  });
});
