/**
 * `scripts/preflight.mjs` and `scripts/check.mjs` run as `npm run preflight`
 * and `npm run check` run them, in a throwaway repository whose steps are
 * stand-ins that pass, so each test shows one reason preflight records an
 * approval or refuses to, or what a gate runs.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PreflightSandbox } from "./support/preflight-sandbox.ts";

let sandbox: PreflightSandbox;

beforeEach(() => {
  sandbox = new PreflightSandbox();
});

afterEach(() => {
  sandbox.remove();
});

const OTHER_SHA = "a".repeat(40);

const CHECK_COMMANDS = [
  "npx --no-install biome check .",
  "npx --no-install tsc --noEmit",
  "npx --no-install tsc --noEmit -p tsconfig.tools.json",
  "npx --no-install vitest run",
];

describe("the steps", () => {
  it("check lints, typechecks both projects and runs every test, in that order", () => {
    const outcome = sandbox.check();
    expect(outcome.status).toBe(0);
    expect(sandbox.commandsRun()).toEqual(CHECK_COMMANDS);
  });

  it("preflight runs everything check does, then the build, the package and the live battery", () => {
    const outcome = sandbox.preflight();
    expect(outcome.status).toBe(0);
    expect(sandbox.commandsRun()).toEqual([
      ...CHECK_COMMANDS,
      "npx --no-install tsc",
      "npm pack --dry-run --json --ignore-scripts",
      "node tests/run-no-pro.mjs",
    ]);
  });

  it("records nothing when a step fails", () => {
    sandbox.repository.stamp("preflight-ok", [OTHER_SHA]);
    sandbox.standIn("node", "exit 1");
    const outcome = sandbox.preflight();
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toContain(
      "FAIL Live no-pro battery (local Comet) failed",
    );
    expect(sandbox.approvals()).toBe(`${OTHER_SHA}\n`);
  });

  it("stops the live battery at its time limit, fails, and records nothing", () => {
    sandbox.limitLiveBatteryTo(1000);
    sandbox.standIn("node", "exec sleep 5");
    const outcome = sandbox.preflight();
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toContain("FAIL node timed out after 1s");
    expect(outcome.stdout).toContain(
      "FAIL Live no-pro battery (local Comet) failed",
    );
    expect(sandbox.approvals()).toBeNull();
  });
});

describe("the clean-tree check", () => {
  it("refuses a dirty working tree before running any step", () => {
    writeFileSync(join(sandbox.root, "stray.txt"), "uncommitted\n");
    const outcome = sandbox.preflight();
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toContain("FAIL uncommitted changes");
    expect(outcome.stderr).toContain("the working tree:\n?? stray.txt");
    expect(sandbox.commandsRun()).toEqual([]);
    expect(sandbox.approvals()).toBeNull();
  });

  it("refuses a dirty notebook before running any step", () => {
    sandbox.addNotebook();
    writeFileSync(join(sandbox.notebook, "plan.md"), "# Plan, ticked\n");
    const outcome = sandbox.preflight();
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toContain("FAIL uncommitted changes");
    expect(outcome.stderr).toContain(".work/:\n M plan.md");
    expect(sandbox.commandsRun()).toEqual([]);
    expect(sandbox.approvals()).toBeNull();
  });

  it("records HEAD when both trees are clean and every step passes", () => {
    sandbox.addNotebook();
    const outcome = sandbox.preflight();
    expect(outcome.status).toBe(0);
    expect(sandbox.approvals()).toBe(`${sandbox.repository.head()}\n`);
  });

  it("passes in a clone without .work/", () => {
    const outcome = sandbox.preflight();
    expect(outcome.status).toBe(0);
    expect(sandbox.approvals()).toBe(`${sandbox.repository.head()}\n`);
  });

  it("stops, naming the command, when .work/ is not a git repository", () => {
    sandbox.addPlainNotebookDirectory();
    const outcome = sandbox.preflight();
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toMatch(
      /git -C \S*\/\.work status --porcelain failed/,
    );
    expect(outcome.stdout).not.toContain("Lint and format");
    expect(sandbox.approvals()).toBeNull();
  });

  it("stops, naming the command, when git status fails in the public tree", () => {
    sandbox.failGit("status --porcelain");
    const outcome = sandbox.preflight();
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toContain("git status --porcelain failed");
    expect(outcome.stdout).not.toContain("Lint and format");
    expect(sandbox.approvals()).toBeNull();
  });
});

describe("recording the approval", () => {
  it("with --allow-dirty, runs every step on dirty trees and records nothing", () => {
    sandbox.addNotebook();
    writeFileSync(join(sandbox.root, "stray.txt"), "uncommitted\n");
    writeFileSync(join(sandbox.notebook, "plan.md"), "# Plan, ticked\n");
    const outcome = sandbox.preflight(["--allow-dirty"]);
    expect(outcome.status).toBe(0);
    expect(sandbox.commandsRun()).toContain("node tests/run-no-pro.mjs");
    expect(outcome.stdout).toContain(
      "WARN --allow-dirty: no stamp written, the push and PR hooks will still refuse",
    );
    expect(sandbox.approvals()).toBeNull();
  });

  it("with --allow-dirty, records nothing even on clean trees", () => {
    sandbox.repository.stamp("preflight-ok", [OTHER_SHA]);
    const outcome = sandbox.preflight(["--allow-dirty"]);
    expect(outcome.status).toBe(0);
    expect(sandbox.approvals()).toBe(`${OTHER_SHA}\n`);
  });

  it("records nothing, naming the command, when git rev-parse HEAD fails", () => {
    sandbox.repository.stamp("preflight-ok", [OTHER_SHA]);
    sandbox.failGit("rev-parse HEAD");
    const outcome = sandbox.preflight();
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toContain("git rev-parse HEAD failed");
    expect(sandbox.approvals()).toBe(`${OTHER_SHA}\n`);
  });
});

describe("the package contents step", () => {
  it("fails, naming the command, when npm pack fails", () => {
    sandbox.standIn("npm", 'echo "npm error: stand-in" >&2; exit 1');
    const outcome = sandbox.preflight();
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toContain(
      "Package contents threw: npm pack --dry-run --json --ignore-scripts failed: npm error: stand-in",
    );
    expect(sandbox.approvals()).toBeNull();
  });
});
