import { describe, expect, it } from "vitest";

import { ModeCore } from "../../src/core/mode.js";
import { answerModeTool } from "../../src/core/mode-tool.js";
import {
  batteryPassed,
  type ScoredCheck,
  summaryLine,
} from "../lib/battery-score.mjs";
import {
  connected,
  type DebugPort,
  hasScreenshot,
  invalidModeHandled,
  labsNotOffered,
  reportsMode,
  runNoProBattery,
  switchedTo,
  type ToolReply,
  tabsListed,
} from "../lib/no-pro-checks.mjs";
import { FakeModePage } from "../unit/fakes/fake-mode-page.js";
import {
  error,
  fakeServer,
  key,
  modeReport,
  ok,
  type Replies,
} from "./support/battery-replies.js";

const MODE_REPORT = modeReport("search");
const UNKNOWN_MODE_REPORT = modeReport(
  "unknown (no mode button found on the page)",
);
const PAGE_FAILED_MODE_REPORT = error(
  modeReport("unknown (the page failed: Execution context was destroyed)"),
);
const LABS_NOT_OFFERED =
  "Cannot switch to labs mode: not offered by Perplexity's current input bar";
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

  it("fails on an error result, even one whose text is long", () => {
    const longError = `Error: Screenshot failed: ${"the page did not answer. ".repeat(8)}`;
    expect(longError.length).toBeGreaterThan(100);
    expect(hasScreenshot(error(longError))).toBe(false);
  });

  it("fails on an error result carrying an image", () => {
    expect(
      hasScreenshot({
        content: [{ type: "image", data: "iVBOR", mimeType: "image/png" }],
        isError: true,
      }),
    ).toBe(false);
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
  it("holds when the reply reports a mode read from the page", () => {
    expect(reportsMode(ok(MODE_REPORT))).toBe(true);
    expect(reportsMode(ok(modeReport("research")))).toBe(true);
  });

  it("fails when the reply names none", () => {
    expect(reportsMode(ok(""))).toBe(false);
  });

  it("fails when the mode is unknown, although the reply lists every mode", () => {
    expect(reportsMode(ok(UNKNOWN_MODE_REPORT))).toBe(false);
    expect(
      reportsMode(
        ok(modeReport("unknown (the mode button reads Deep research)")),
      ),
    ).toBe(false);
  });

  it("fails on an error result, even one that names a mode", () => {
    expect(reportsMode(PAGE_FAILED_MODE_REPORT)).toBe(false);
    expect(reportsMode(error(MODE_REPORT))).toBe(false);
  });
});

describe("labsNotOffered [7.2-labs]", () => {
  it("holds on the error saying Perplexity no longer offers labs", () => {
    expect(labsNotOffered(error(LABS_NOT_OFFERED))).toBe(true);
  });

  it("fails when the switch to labs is reported as done", () => {
    expect(labsNotOffered(ok("Switched to labs mode"))).toBe(false);
  });

  it("fails on any other error", () => {
    expect(
      labsNotOffered(
        error("Cannot switch to labs mode: no mode button found on the page"),
      ),
    ).toBe(false);
    expect(labsNotOffered(error("Error: Not connected to Comet"))).toBe(false);
    expect(
      labsNotOffered(
        error(
          "Cannot switch to learn mode: not offered by Perplexity's current input bar",
        ),
      ),
    ).toBe(false);
  });

  it("fails on the not-offered text when it is not an error result", () => {
    expect(labsNotOffered(ok(LABS_NOT_OFFERED))).toBe(false);
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

  // reportsMode decides the follow-up call too, so a follow-up that cannot
  // read the mode fails [9.4]: the server answered, but not with a mode.
  it("fails when the next call reports the mode as unknown", () => {
    expect(invalidModeHandled(rejected, ok(UNKNOWN_MODE_REPORT))).toBe(false);
  });

  it("fails when the next call is an error that names a mode", () => {
    expect(invalidModeHandled(rejected, PAGE_FAILED_MODE_REPORT)).toBe(false);
  });
});

describe("the mode predicates against the server's own comet_mode replies", () => {
  async function serverReply(
    mode: string | undefined,
    page: FakeModePage,
  ): Promise<ToolReply> {
    const reply = await answerModeTool(mode, {
      core: new ModeCore(page),
      openPerplexity: async () => {},
      quotePage: (pageText) => pageText,
    });
    return reply.isError ? error(reply.text) : ok(reply.text);
  }

  it("[7.2-labs] holds on the server's refusal of labs", async () => {
    expect(labsNotOffered(await serverReply("labs", new FakeModePage()))).toBe(
      true,
    );
  });

  it("[7.1] holds on the mode the server reads from the page", async () => {
    const page = new FakeModePage({ current: "Deep research" });
    expect(reportsMode(await serverReply(undefined, page))).toBe(true);
  });

  it("[7.1] fails when the server finds no mode button", async () => {
    const page = new FakeModePage({ hasButton: false });
    expect(reportsMode(await serverReply(undefined, page))).toBe(false);
  });
});

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
  [key("comet_mode", { mode: "labs" })]: error(LABS_NOT_OFFERED),
  [key("comet_mode", { mode: "learn" })]: error(
    "Cannot switch to learn mode: not supported yet",
  ),
  [key("comet_mode", { mode: "search" })]: ok("Switched to search mode"),
  [key("comet_mode", { mode: "invalid_mode_xyz" })]: error(
    "Invalid mode: invalid_mode_xyz. Use: search, research, labs, learn",
  ),
};

const LISTENING: DebugPort = { port: 9223, answers: async () => true };
const SILENT: DebugPort = { port: 9223, answers: async () => false };

const byId = (checks: readonly ScoredCheck[], id: string) =>
  checks.find((check) => check.id === id);

describe("runNoProBattery", () => {
  it("scores today's Comet as 9 passed and 1 known, and passes", async () => {
    const checks = await runNoProBattery(
      fakeServer(HEALTHY).callTool,
      LISTENING,
    );
    expect(summaryLine(checks)).toBe("Results: 9 passed, 0 failed, 1 known");
    expect(batteryPassed(checks)).toBe(true);
    expect(byId(checks, "7.2-labs")).toMatchObject({
      verdict: "PASS",
      note: LABS_NOT_OFFERED.slice(0, 60),
    });
    expect(byId(checks, "7.2-learn")?.verdict).toBe("KNOWN");
  });

  it("fails [7.2-labs] when the switch to labs is reported as done", async () => {
    const checks = await runNoProBattery(
      fakeServer({
        ...HEALTHY,
        [key("comet_mode", { mode: "labs" })]: ok("Switched to labs mode"),
      }).callTool,
      LISTENING,
    );
    expect(byId(checks, "7.2-labs")?.verdict).toBe("FAIL");
    expect(batteryPassed(checks)).toBe(false);
  });

  it("fails [7.1] and [7.3-reconnect] when the mode cannot be read", async () => {
    const checks = await runNoProBattery(
      fakeServer({
        ...HEALTHY,
        [key("comet_mode", {})]: ok(UNKNOWN_MODE_REPORT),
      }).callTool,
      LISTENING,
    );
    expect(byId(checks, "7.1")?.verdict).toBe("FAIL");
    expect(byId(checks, "7.3-reconnect")?.verdict).toBe("FAIL");
    expect(byId(checks, "9.4")?.verdict).toBe("FAIL");
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

  it("fails [5.1] when the screenshot is an error result", async () => {
    const checks = await runNoProBattery(
      fakeServer({
        ...HEALTHY,
        [key("comet_screenshot", {})]: error(
          `Error: Screenshot failed: ${"the page did not answer. ".repeat(8)}`,
        ),
      }).callTool,
      LISTENING,
    );
    expect(byId(checks, "5.1")?.verdict).toBe("FAIL");
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
      fakeServer(HEALTHY, {
        after: key("comet_mode", { mode: "invalid_mode_xyz" }),
        error: new Error("TIMEOUT after 10000ms"),
      }).callTool,
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
