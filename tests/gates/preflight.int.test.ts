/**
 * `scripts/preflight.mjs` run as `npm run preflight` runs it, in a throwaway
 * repository whose steps are stand-ins that pass, so each test shows one
 * reason preflight records an approval or refuses to.
 */
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

describe("the clean-tree check", () => {
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
