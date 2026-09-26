/**
 * `scripts/update-bridge.mjs` runs as `npm run bridge:update` runs it, against
 * a throwaway home directory and stand-in `git`, `npx` and `claude`, so each
 * test shows what the script changes, and what it leaves alone when the new
 * build or the configuration step fails.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BRIDGE_TOOLS } from "../../scripts/lib/bridge.mjs";
import { BridgeSandbox, MAIN_TIP } from "./support/bridge-sandbox.ts";
import { GIT_HEAVY_TEST_MS } from "./support/git-sandbox.ts";

const OLD = "a".repeat(40);
const CHOSEN = "c".repeat(40);
const spec = (sha: string) => `github:owner/repo#${sha}`;
const pinned = (sha: string, port = "9222") => ({
  type: "stdio",
  command: "npx",
  args: ["-y", spec(sha)],
  env: { COMET_PORT: port },
});
const addJson = (entry: object) =>
  `mcp add-json -s user comet-bridge ${JSON.stringify(entry)}`;
const REMOVE = "mcp remove comet-bridge -s user";

let sandbox: BridgeSandbox;

beforeEach(() => {
  sandbox = new BridgeSandbox();
});

afterEach(() => {
  sandbox.remove();
});

describe("moving to the tip of main", { timeout: GIT_HEAVY_TEST_MS }, () => {
  it("checks the new build, then replaces the entry, keeping its port", () => {
    sandbox.configure(pinned(OLD));
    const outcome = sandbox.update();
    expect(outcome.stderr).toBe("");
    expect(outcome.status).toBe(0);
    expect(sandbox.callsTo("npx")).toEqual([
      `-y ${spec(MAIN_TIP)} COMET_PORT=9222`,
    ]);
    expect(sandbox.callsTo("claude")).toEqual([
      REMOVE,
      addJson(pinned(MAIN_TIP)),
    ]);
    expect(outcome.stdout).toContain(
      `${OLD.slice(0, 7)} -> ${MAIN_TIP.slice(0, 7)}`,
    );
    expect(outcome.stdout).toContain("/mcp");
  });

  it("changes nothing when the entry already runs the tip of main", () => {
    sandbox.configure(pinned(MAIN_TIP));
    const outcome = sandbox.update();
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain("already runs");
    expect(sandbox.callsTo("npx")).toEqual([]);
    expect(sandbox.callsTo("claude")).toEqual([]);
  });

  it("adds the entry, on the server's default port, when there is none", () => {
    sandbox.configure(null);
    const outcome = sandbox.update();
    expect(outcome.status).toBe(0);
    expect(sandbox.callsTo("claude")).toEqual([
      addJson(pinned(MAIN_TIP, "9223")),
    ]);
  });

  it("replaces an entry that runs another package", () => {
    sandbox.configure({ command: "npx", args: ["-y", "comet-mcp@2.3.0"] });
    const outcome = sandbox.update();
    expect(outcome.status).toBe(0);
    expect(sandbox.callsTo("claude")).toEqual([
      REMOVE,
      addJson(pinned(MAIN_TIP, "9223")),
    ]);
  });
});

describe("choosing the commit and the port", {
  timeout: GIT_HEAVY_TEST_MS,
}, () => {
  it("pins the commit given as an argument, without asking GitHub for main", () => {
    sandbox.configure(pinned(OLD));
    const outcome = sandbox.update([CHOSEN]);
    expect(outcome.status).toBe(0);
    expect(sandbox.callsTo("git")).toEqual(["remote get-url origin"]);
    expect(sandbox.callsTo("claude")).toEqual([
      REMOVE,
      addJson(pinned(CHOSEN)),
    ]);
  });

  it("refuses a commit that is not a full sha, and runs nothing", () => {
    sandbox.configure(pinned(OLD));
    const outcome = sandbox.update(["main"]);
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("full 40-character commit sha");
    expect(sandbox.callsTo("npx")).toEqual([]);
    expect(sandbox.callsTo("claude")).toEqual([]);
  });

  it("uses COMET_PORT from the environment over the entry's", () => {
    sandbox.configure(pinned(OLD, "9222"));
    const outcome = sandbox.update([], { COMET_PORT: "9444" });
    expect(outcome.status).toBe(0);
    expect(sandbox.callsTo("npx")).toEqual([
      `-y ${spec(MAIN_TIP)} COMET_PORT=9444`,
    ]);
    expect(sandbox.callsTo("claude")).toEqual([
      REMOVE,
      addJson(pinned(MAIN_TIP, "9444")),
    ]);
  });

  it("reads .claude.json from CLAUDE_CONFIG_DIR when it is set", () => {
    const directory = sandbox.configDirectory();
    sandbox.configure(pinned(MAIN_TIP), directory);
    sandbox.configure(pinned(OLD));
    const outcome = sandbox.update([], { CLAUDE_CONFIG_DIR: directory });
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain("already runs");
  });
});

describe("a build that does not work", { timeout: GIT_HEAVY_TEST_MS }, () => {
  it("leaves the entry alone when the build lacks a tool", () => {
    sandbox.configure(pinned(OLD));
    sandbox.offerTools(BRIDGE_TOOLS.filter((tool) => tool !== "comet_mode"));
    const outcome = sandbox.update();
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("comet_mode");
    expect(outcome.stderr).toContain("left unchanged");
    expect(sandbox.callsTo("claude")).toEqual([]);
  });

  it("leaves the entry alone when the build does not start", () => {
    sandbox.configure(pinned(OLD));
    sandbox.buildFails();
    const outcome = sandbox.update();
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("left unchanged");
    expect(sandbox.callsTo("claude")).toEqual([]);
  });
});

describe("a configuration step that fails", {
  timeout: GIT_HEAVY_TEST_MS,
}, () => {
  it("stops, adding nothing, when the old entry cannot be removed", () => {
    sandbox.configure(pinned(OLD));
    sandbox.claudeFailsOn("mcp remove");
    const outcome = sandbox.update();
    expect(outcome.status).toBe(1);
    expect(sandbox.callsTo("claude")).toEqual([REMOVE]);
  });

  it("puts the old entry back when the new one cannot be added", () => {
    const old = pinned(OLD);
    sandbox.configure(old);
    sandbox.claudeFailsOn(MAIN_TIP);
    const outcome = sandbox.update();
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("restored");
    expect(sandbox.callsTo("claude")).toEqual([
      REMOVE,
      addJson(pinned(MAIN_TIP)),
      addJson(old),
    ]);
  });
});
