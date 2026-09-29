import { describe, expect, it } from "vitest";
import { answerConnect } from "../../../src/core/connect.js";
import { FakeCometLaunch } from "../fakes/fake-comet-launch.js";

function tabsThatSay(line: string) {
  const calls: string[] = [];
  return {
    calls,
    connectToPerplexity: async () => {
      calls.push("connectToPerplexity");
      return line;
    },
  };
}

describe("answerConnect", () => {
  it("names the port, not only the version, when Comet already answers on it", async () => {
    const launch = new FakeCometLaunch();
    launch.answering = "Comet/140.0";
    const tabs = tabsThatSay("Connected to Perplexity");

    const reply = await answerConnect({ launch, port: 9222, tabs });

    expect(reply).toEqual({
      kind: "text",
      text: "Comet is running with the debug port 9222 (Comet/140.0).\nConnected to Perplexity",
      isError: false,
    });
    expect(launch.launches).toEqual([]);
  });

  it("launches Comet on the configured port when none runs, and says so", async () => {
    const launch = new FakeCometLaunch();
    const tabs = tabsThatSay("Connected to Perplexity");

    const reply = await answerConnect({ launch, port: 9555, tabs });

    expect(launch.launches).toEqual([9555]);
    expect(reply).toEqual({
      kind: "text",
      text: "Started Comet with the debug port 9555 (Comet/141.0).\nConnected to Perplexity",
      isError: false,
    });
  });

  it("fails naming the port and the command when Comet runs without the port, and starts nothing", async () => {
    const launch = new FakeCometLaunch();
    launch.processRunning = true;
    const tabs = tabsThatSay("never said");

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
    const tabs = tabsThatSay("never said");

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
      tabs: tabsThatSay("Connected to Perplexity"),
    });

    expect(JSON.stringify(reply)).toMatch(/connected|started|running/i);
  });
});
