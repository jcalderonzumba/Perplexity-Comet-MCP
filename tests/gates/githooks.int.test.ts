/**
 * The git hooks and the stamp checks they share with the Claude Code PR gate
 * (`.githooks/`), run as git runs them, against a throwaway repository.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GitSandbox } from "./support/git-sandbox.ts";

let sandbox: GitSandbox;

beforeEach(() => {
  sandbox = new GitSandbox();
});

afterEach(() => {
  sandbox.remove();
});

const OTHER_SHA = "a".repeat(40);

describe("pre-commit", () => {
  it("refuses a commit on main", () => {
    const outcome = sandbox.run(".githooks/pre-commit");
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("commits on main are forbidden");
  });

  it("allows a commit on any other branch", () => {
    sandbox.git("switch", "--quiet", "--create", "feat/working-model-p9-x");
    expect(sandbox.run(".githooks/pre-commit").status).toBe(0);
  });
});

describe.each([
  ["review-check.sh", "review-ok", "the phase review has not approved HEAD"],
  ["preflight-check.sh", "preflight-ok", "preflight has not passed on HEAD"],
] as const)("%s", (script, stamp, refusal) => {
  const check = () => sandbox.run(`.githooks/${script}`, [sandbox.root]);

  it("refuses when there is no stamp", () => {
    const outcome = check();
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain(refusal);
  });

  it("refuses when the stamp lists other commits only", () => {
    sandbox.stamp(stamp, [OTHER_SHA]);
    expect(check().status).toBe(1);
  });

  it("passes when HEAD is one of the listed commits", () => {
    sandbox.stamp(stamp, [OTHER_SHA, sandbox.head(), "b".repeat(40)]);
    expect(check().status).toBe(0);
  });

  it("refuses again once another commit moves HEAD", () => {
    sandbox.stamp(stamp, [sandbox.head()]);
    sandbox.commit("one more");
    expect(check().status).toBe(1);
  });

  it("never reads a sha prefix as HEAD", () => {
    sandbox.stamp(stamp, [sandbox.head().slice(0, 12), `${sandbox.head()}0`]);
    expect(check().status).toBe(1);
  });

  it("keeps an approval on a branch while another branch is stamped", () => {
    sandbox.git("switch", "--quiet", "--create", "feat/a");
    const a = sandbox.commit("a");
    sandbox.git("switch", "--quiet", "main");
    sandbox.git("switch", "--quiet", "--create", "feat/b");
    const b = sandbox.commit("b");
    sandbox.stamp(stamp, [a, b]);
    expect(check().status).toBe(0);
    sandbox.git("switch", "--quiet", "feat/a");
    expect(check().status).toBe(0);
  });
});

describe("preflight-check.sh in a repository with no preflight script", () => {
  it("has nothing to gate", () => {
    sandbox.git("rm", "--quiet", "package.json");
    sandbox.commit("docs only");
    expect(sandbox.run(".githooks/preflight-check.sh", [sandbox.root]).status).toBe(0);
  });
});

describe("review-withdraw.sh", () => {
  const stampFile = () => join(sandbox.root, ".git", "review-ok");
  const withdraw = () => sandbox.run(".githooks/review-withdraw.sh", [sandbox.root]);

  it("removes HEAD and keeps every other approval", () => {
    const head = sandbox.head();
    sandbox.stamp("review-ok", [OTHER_SHA, head, "b".repeat(40), head]);
    expect(withdraw().status).toBe(0);
    expect(readFileSync(stampFile(), "utf8")).toBe(`${OTHER_SHA}\n${"b".repeat(40)}\n`);
    expect(sandbox.run(".githooks/review-check.sh", [sandbox.root]).status).toBe(1);
  });

  it("leaves an empty file when HEAD was the only approval", () => {
    sandbox.stamp("review-ok", [sandbox.head()]);
    expect(withdraw().status).toBe(0);
    expect(readFileSync(stampFile(), "utf8")).toBe("");
  });

  it("creates no stamp when there is none", () => {
    expect(withdraw().status).toBe(0);
    expect(existsSync(stampFile())).toBe(false);
  });
});

describe("pre-push", () => {
  const push = (remoteRef: string) =>
    sandbox.run(".githooks/pre-push", ["origin", "git@example.invalid:comet-mcp.git"], {
      stdin: `refs/heads/x ${sandbox.head()} ${remoteRef} ${"0".repeat(40)}\n`,
    });

  beforeEach(() => {
    sandbox.git("switch", "--quiet", "--create", "feat/working-model-p9-x");
  });

  it("refuses a push to main even with both stamps", () => {
    sandbox.stamp("review-ok", [sandbox.head()]);
    sandbox.stamp("preflight-ok", [sandbox.head()]);
    const outcome = push("refs/heads/main");
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("pushing to main is forbidden");
  });

  it("refuses a branch push the review has not approved", () => {
    sandbox.stamp("preflight-ok", [sandbox.head()]);
    const outcome = push("refs/heads/feat/working-model-p9-x");
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("the phase review has not approved HEAD");
  });

  it("refuses a branch push preflight has not passed", () => {
    sandbox.stamp("review-ok", [sandbox.head()]);
    const outcome = push("refs/heads/feat/working-model-p9-x");
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("preflight has not passed on HEAD");
  });

  it("allows a branch push with HEAD in both stamps", () => {
    sandbox.stamp("review-ok", [OTHER_SHA, sandbox.head()]);
    sandbox.stamp("preflight-ok", [sandbox.head(), OTHER_SHA]);
    expect(push("refs/heads/feat/working-model-p9-x").status).toBe(0);
  });
});
