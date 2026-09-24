import { describe, expect, it } from "vitest";

import {
  batteryPassed,
  type ScoredCheck,
  summaryLine,
} from "../lib/battery-score.mjs";
import {
  type CallTool,
  connected,
  type DebugPort,
  hasScreenshot,
  invalidModeHandled,
  reportsMode,
  runNoProBattery,
  switchedTo,
  type ToolReply,
  tabsListed,
} from "../lib/no-pro-checks.mjs";

const ok = (text: string): ToolReply => ({
  content: [{ type: "text", text }],
});
const error = (text: string): ToolReply => ({
  content: [{ type: "text", text }],
  isError: true,
});

const MODE_REPORT = "Current mode: search\n\nAvailable modes:\n→ search: Basic";
const COMET_DOWN =
  "Error: Timeout waiting for Comet. Try: /Applications/Comet.app --remote-debugging-port=9222";

describe("connected [1.2]", () => {
  it("holds when connect says it connected", () => {
    expect(
      connected(
        ok("Comet already running with debug port: Chrome/140\nConnected"),
      ),
    ).toBe(true);
  });

  it("fails on an error result, even one that mentions running", () => {
    expect(connected(error(COMET_DOWN))).toBe(false);
    expect(connected(error("Error: Comet is not running"))).toBe(false);
  });

  it("fails on a reply that does not say connected, started or running", () => {
    expect(connected(ok("Something else happened"))).toBe(false);
  });
});

describe("hasScreenshot [5.1]", () => {
  it("holds on an image", () => {
    expect(
      hasScreenshot({
        content: [{ type: "image", data: "iVBOR", mimeType: "image/png" }],
      }),
    ).toBe(true);
  });

  it("fails on an empty reply", () => {
    expect(hasScreenshot({ content: [] })).toBe(false);
  });
});

describe("tabsListed [6.1]", () => {
  it("holds when the listing returns no error", () => {
    expect(tabsListed(ok("Tabs (1):\n  perplexity.ai [active]"))).toBe(true);
  });

  it("fails on an error result", () => {
    expect(tabsListed(error("Error: Not connected to Comet"))).toBe(false);
  });
});

describe("reportsMode [7.1] [7.3-reconnect]", () => {
  it("holds when the reply names a mode", () => {
    expect(reportsMode(ok(MODE_REPORT))).toBe(true);
  });

  it("fails when the reply names none", () => {
    expect(reportsMode(ok(""))).toBe(false);
  });
});

describe("switchedTo [7.2-<mode>]", () => {
  it("holds when the reply says the switch to that mode happened", () => {
    expect(switchedTo("research", ok("Switched to research mode"))).toBe(true);
  });

  it("fails when the mode option was not found", () => {
    expect(
      switchedTo("labs", error("Failed: Mode option not found in dropdown")),
    ).toBe(false);
  });

  it("fails when the reply names another mode", () => {
    expect(switchedTo("search", ok("Switched to research mode"))).toBe(false);
  });

  it("fails on an error result that says it switched", () => {
    expect(switchedTo("learn", error("Switched to learn mode"))).toBe(false);
  });
});

describe("invalidModeHandled [9.4]", () => {
  const rejected = error(
    "Invalid mode: invalid_mode_xyz. Use: search, research",
  );

  it("holds when the invalid mode is an error and the server still answers", () => {
    expect(invalidModeHandled(rejected, ok(MODE_REPORT))).toBe(true);
  });

  it("fails when the invalid mode is accepted", () => {
    expect(
      invalidModeHandled(
        ok("Switched to invalid_mode_xyz mode"),
        ok(MODE_REPORT),
      ),
    ).toBe(false);
  });

  it("fails when the next call returns an error", () => {
    expect(
      invalidModeHandled(rejected, error("Error: Not connected to Comet")),
    ).toBe(false);
  });
});

type Replies = Record<string, ToolReply | Error>;

const key = (name: string, args: Record<string, unknown>) =>
  `${name} ${JSON.stringify(args)}`;

const HEALTHY: Replies = {
  [key("comet_connect", {})]: ok(
    "Comet already running with debug port: Chrome/140\nConnected to Perplexity",
  ),
  [key("comet_screenshot", {})]: {
    content: [{ type: "image", data: "iVBOR", mimeType: "image/png" }],
  },
  [key("comet_tabs", {})]: ok("Tabs (1):\n  perplexity.ai [active]"),
  [key("comet_mode", {})]: ok(MODE_REPORT),
  [key("comet_mode", { mode: "research" })]: ok("Switched to research mode"),
  [key("comet_mode", { mode: "labs" })]: error(
    "Failed: Mode option not found in dropdown",
  ),
  [key("comet_mode", { mode: "learn" })]: error(
    "Failed: Mode option not found in dropdown",
  ),
  [key("comet_mode", { mode: "search" })]: ok("Switched to search mode"),
  [key("comet_mode", { mode: "invalid_mode_xyz" })]: error(
    "Invalid mode: invalid_mode_xyz. Use: search, research, labs, learn",
  ),
};

/** A stand-in for the server: answers from `replies`, in order of `calls`. */
function fakeServer(replies: Replies, afterInvalidMode?: Error) {
  const calls: string[] = [];
  let invalidModeSeen = false;
  const callTool: CallTool = async (name, args) => {
    const call = key(name, args);
    calls.push(call);
    if (invalidModeSeen && afterInvalidMode) throw afterInvalidMode;
    if (call === key("comet_mode", { mode: "invalid_mode_xyz" })) {
      invalidModeSeen = true;
    }
    const reply = replies[call];
    if (reply === undefined) throw new Error(`unexpected call ${call}`);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { callTool, calls };
}

const LISTENING: DebugPort = { port: 9223, answers: async () => true };
const SILENT: DebugPort = { port: 9223, answers: async () => false };

const byId = (checks: readonly ScoredCheck[], id: string) =>
  checks.find((check) => check.id === id);

describe("runNoProBattery", () => {
  it("scores today's Comet as 8 passed and 2 known, and passes", async () => {
    const checks = await runNoProBattery(
      fakeServer(HEALTHY).callTool,
      LISTENING,
    );
    expect(summaryLine(checks)).toBe("Results: 8 passed, 0 failed, 2 known");
    expect(batteryPassed(checks)).toBe(true);
  });

  it("makes the same tool calls as before, plus one read-only mode query after the invalid mode", async () => {
    const server = fakeServer(HEALTHY);
    await runNoProBattery(server.callTool, LISTENING);
    expect(server.calls).toEqual([
      key("comet_connect", {}),
      key("comet_screenshot", {}),
      key("comet_tabs", {}),
      key("comet_mode", {}),
      key("comet_mode", { mode: "research" }),
      key("comet_mode", { mode: "labs" }),
      key("comet_mode", { mode: "learn" }),
      key("comet_mode", { mode: "search" }),
      key("comet_mode", {}),
      key("comet_mode", { mode: "invalid_mode_xyz" }),
      key("comet_mode", {}),
    ]);
  });

  it("reports each check as it is scored, in order", async () => {
    const reported: string[] = [];
    await runNoProBattery(fakeServer(HEALTHY).callTool, LISTENING, (check) =>
      reported.push(check.id),
    );
    expect(reported).toEqual([
      "1.2",
      "5.1",
      "6.1",
      "7.1",
      "7.2-research",
      "7.2-labs",
      "7.2-learn",
      "7.2-search",
      "7.3-reconnect",
      "9.4",
    ]);
  });

  it("fails a mode switch that did not happen", async () => {
    const checks = await runNoProBattery(
      fakeServer({
        ...HEALTHY,
        [key("comet_mode", { mode: "research" })]: error(
          "Failed: Mode option not found in dropdown",
        ),
      }).callTool,
      LISTENING,
    );
    expect(byId(checks, "7.2-research")).toMatchObject({
      verdict: "FAIL",
      note: "Failed: Mode option not found in dropdown",
    });
    expect(batteryPassed(checks)).toBe(false);
  });

  it("fails a tab listing that returned an error", async () => {
    const checks = await runNoProBattery(
      fakeServer({
        ...HEALTHY,
        [key("comet_tabs", {})]: error("Error: Not connected"),
      }).callTool,
      LISTENING,
    );
    expect(byId(checks, "6.1")?.verdict).toBe("FAIL");
  });

  it("fails [9.4] when the invalid mode crashes the server", async () => {
    const checks = await runNoProBattery(
      fakeServer({
        ...HEALTHY,
        [key("comet_mode", { mode: "invalid_mode_xyz" })]: new Error(
          "MCP error -32000: Connection closed",
        ),
      }).callTool,
      LISTENING,
    );
    expect(byId(checks, "9.4")).toMatchObject({
      verdict: "FAIL",
      note: "MCP error -32000: Connection closed",
    });
  });

  it("fails [9.4] when the server stops answering after the invalid mode", async () => {
    const checks = await runNoProBattery(
      fakeServer(HEALTHY, new Error("TIMEOUT after 10000ms")).callTool,
      LISTENING,
    );
    expect(byId(checks, "9.4")).toMatchObject({
      verdict: "FAIL",
      note: "TIMEOUT after 10000ms",
    });
  });

  describe("when connect fails", () => {
    const cometDown = () =>
      fakeServer({ ...HEALTHY, [key("comet_connect", {})]: error(COMET_DOWN) });

    it("fails at [1.2] with the connection problem as its note", async () => {
      const checks = await runNoProBattery(cometDown().callTool, LISTENING);
      expect(checks[0]).toMatchObject({ id: "1.2", verdict: "FAIL" });
      expect(checks[0]?.note).toContain("Timeout waiting for Comet");
      expect(batteryPassed(checks)).toBe(false);
    });

    it("passes no later check, and calls no other tool", async () => {
      const server = cometDown();
      const checks = await runNoProBattery(server.callTool, LISTENING);
      expect(server.calls).toEqual([key("comet_connect", {})]);
      expect(checks).toHaveLength(10);
      for (const check of checks) {
        expect(check.verdict).not.toBe("PASS");
        expect(check.verdict).not.toBe("UNEXPECTED PASS");
      }
      expect(byId(checks, "5.1")?.note).toBe("not run: [1.2] connect failed");
    });

    it("fails at [1.2] when connect times out", async () => {
      const checks = await runNoProBattery(
        fakeServer({
          ...HEALTHY,
          [key("comet_connect", {})]: new Error("TIMEOUT after 30000ms"),
        }).callTool,
        LISTENING,
      );
      expect(checks[0]).toMatchObject({
        id: "1.2",
        verdict: "FAIL",
        note: "TIMEOUT after 30000ms",
      });
    });
  });

  describe("when Comet does not answer on its debug port", () => {
    it("fails at [1.2] naming the port, without calling any tool", async () => {
      const server = fakeServer(HEALTHY);
      const checks = await runNoProBattery(server.callTool, SILENT);
      expect(server.calls).toEqual([]);
      expect(checks[0]).toMatchObject({
        id: "1.2",
        verdict: "FAIL",
        note: "Comet is not running with its debug port on 9223",
      });
      expect(batteryPassed(checks)).toBe(false);
    });

    it("passes no later check", async () => {
      const checks = await runNoProBattery(
        fakeServer(HEALTHY).callTool,
        SILENT,
      );
      expect(checks).toHaveLength(10);
      for (const check of checks.slice(1)) {
        expect(check.note).toBe("not run: [1.2] connect failed");
        expect(["FAIL", "KNOWN"]).toContain(check.verdict);
      }
    });

    it("fails at [1.2] when the port probe itself throws", async () => {
      const checks = await runNoProBattery(fakeServer(HEALTHY).callTool, {
        port: 9223,
        answers: async () => {
          throw new Error("probe failed");
        },
      });
      expect(checks[0]).toMatchObject({
        verdict: "FAIL",
        note: "probe failed",
      });
    });
  });
});
