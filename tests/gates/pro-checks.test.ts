import { describe, expect, it } from "vitest";

import {
  reapplyModeBeforeAsk,
  withModeNotice,
} from "../../src/core/ask-mode.js";
import { ModeCore } from "../../src/core/mode.js";
import { answerModeTool } from "../../src/core/mode-tool.js";
import { wrapUntrustedPageContent } from "../../src/untrusted.js";
import {
  agentOpenedTab,
  agentStopped,
  answered,
  answerNames,
  contextReset,
  emptyPromptRefused,
  fileNotFound,
  followUpAnswered,
  pollAfterStop,
  pollIdle,
  RESEARCH_PROMPT,
  RESEARCH_WORKFLOW,
  researchWorkflowHeld,
  selectorNotFound,
  siteTabClosed,
  switchedToSite,
  tabsKept,
  timeoutStated,
  trendingRepoNamed,
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

describe("answerNames [1.5] [2.1] [2.5] [3.1]", () => {
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
