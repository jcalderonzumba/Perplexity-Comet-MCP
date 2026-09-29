import { describe, expect, it } from "vitest";
import { answerConnect } from "../../../src/core/connect.js";
import {
  PerplexityTab,
  type TabMove,
} from "../../../src/core/perplexity-tab.js";
import { FakeCometLaunch } from "../fakes/fake-comet-launch.js";
import {
  FakeTabPort,
  LOOKALIKE_TAB,
  MAIN_TAB,
  SIDECAR_TAB,
  USER_TAB,
} from "../fakes/fake-tab-port.js";

/** The tab choice, answering the move it is told to and recording its calls. */
function tabsThatMove(move: TabMove) {
  const calls: string[] = [];
  return {
    calls,
    bringToMainPage: async () => {
      calls.push("bringToMainPage");
      return move;
    },
  };
}

const STAYED_LINE =
  "Connected to Perplexity's main page: the connection was already on it.";
const MOVED_LINE =
  "Connected to Perplexity's main page: moved the connection to the tab already open on it.";
const OPENED_LINE =
  "Connected to Perplexity's main page: opened it in a new tab.";

describe("answerConnect", () => {
  it("names the port, not only the version, when Comet already answers on it", async () => {
    const launch = new FakeCometLaunch();
    launch.answering = "Comet/140.0";
    const tabs = tabsThatMove("stayed");

    const reply = await answerConnect({ launch, port: 9222, tabs });

    expect(reply).toEqual({
      kind: "text",
      text: `Comet is running with the debug port 9222 (Comet/140.0).\n${STAYED_LINE}`,
      isError: false,
    });
    expect(launch.launches).toEqual([]);
  });

  it("launches Comet on the configured port when none runs, and says so", async () => {
    const launch = new FakeCometLaunch();
    const tabs = tabsThatMove("stayed");

    const reply = await answerConnect({ launch, port: 9555, tabs });

    expect(launch.launches).toEqual([9555]);
    expect(reply).toEqual({
      kind: "text",
      text: `Started Comet with the debug port 9555 (Comet/141.0).\n${STAYED_LINE}`,
      isError: false,
    });
  });

  it("fails naming the port and the command when Comet runs without the port, and starts nothing", async () => {
    const launch = new FakeCometLaunch();
    launch.processRunning = true;
    const tabs = tabsThatMove("stayed");

    const reply = await answerConnect({ launch, port: 9222, tabs });

    expect(reply.kind).toBe("text");
    if (reply.kind !== "text") return;
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("not with the debug port 9222");
    expect(reply.text).toContain("comet --remote-debugging-port=9222");
    expect(launch.launches).toEqual([]);
    expect(tabs.calls).toEqual([]);
  });

  it("fails naming the port when a launched Comet does not answer in time", async () => {
    const launch = new FakeCometLaunch();
    launch.launchFailure = new Error("Comet did not answer within 20s");
    const tabs = tabsThatMove("stayed");

    const reply = await answerConnect({ launch, port: 9222, tabs });

    expect(reply.kind).toBe("text");
    if (reply.kind !== "text") return;
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("port 9222");
    expect(reply.text).toContain("Comet did not answer within 20s");
    expect(reply.text).toContain("comet --remote-debugging-port=9222");
    expect(tabs.calls).toEqual([]);
  });

  it("carries a word the no-pro battery reads: connected, started or running", async () => {
    const launch = new FakeCometLaunch();
    launch.answering = "Comet/140.0";

    const reply = await answerConnect({
      launch,
      port: 9222,
      tabs: tabsThatMove("stayed"),
    });

    expect(JSON.stringify(reply)).toMatch(/connected|started|running/i);
  });
});

describe("answerConnect's tab choice", () => {
  function connectOver(port: FakeTabPort) {
    const launch = new FakeCometLaunch();
    launch.answering = "Comet/140.0";
    const tabs = new PerplexityTab(port);
    return { tabs, run: () => answerConnect({ launch, port: 9222, tabs }) };
  }

  function lastLine(reply: Awaited<ReturnType<typeof answerConnect>>): string {
    if (reply.kind !== "text") throw new Error("not a text reply");
    return reply.text.split("\n").at(-1) ?? "";
  }

  it("moves off a user's page to the main page open elsewhere, and navigates nothing", async () => {
    const port = new FakeTabPort();
    port.targets = [USER_TAB, MAIN_TAB];
    port.url = USER_TAB.url;

    const reply = await connectOver(port).run();

    expect(port.connectedTo).toEqual([MAIN_TAB.id]);
    expect(port.openedAt).toEqual([]);
    expect(lastLine(reply)).toBe(MOVED_LINE);
  });

  it("opens a new tab, records it and navigates nothing when only the sidecar and a user's page are open", async () => {
    const port = new FakeTabPort();
    port.targets = [SIDECAR_TAB, USER_TAB];
    port.url = USER_TAB.url;
    const { tabs, run } = connectOver(port);

    const reply = await run();

    expect(port.openedAt).toEqual(["https://www.perplexity.ai/"]);
    expect(port.connectedTo).toEqual(["opened-1"]);
    expect(tabs.opened("opened-1")).toBe(true);
    expect(lastLine(reply)).toBe(OPENED_LINE);
    expect(port.calls).not.toContain("navigate");
  });

  it("does not take a page that merely names Perplexity for the main page", async () => {
    const port = new FakeTabPort();
    port.targets = [LOOKALIKE_TAB];
    port.url = LOOKALIKE_TAB.url;

    await connectOver(port).run();

    expect(port.openedAt).toEqual(["https://www.perplexity.ai/"]);
  });

  it("stays when the connection is already on the main page", async () => {
    const port = new FakeTabPort();
    port.targets = [MAIN_TAB, USER_TAB];
    port.url = MAIN_TAB.url;

    const reply = await connectOver(port).run();

    expect(port.connectedTo).toEqual([]);
    expect(port.openedAt).toEqual([]);
    expect(lastLine(reply)).toBe(STAYED_LINE);
  });
});
