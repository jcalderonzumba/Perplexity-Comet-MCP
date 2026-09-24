/**
 * The Claude Code PreToolUse hooks (`.claude/hooks/`), fed the tool input
 * Claude Code sends on stdin, against a throwaway repository.
 */
import { rmSync } from "node:fs";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { GitSandbox, type Outcome, pathWith } from "./support/git-sandbox.ts";

let sandbox: GitSandbox;
let pathWithoutJq: string;

beforeAll(() => {
  pathWithoutJq = pathWith([
    "bash",
    "git",
    "grep",
    "tr",
    "cat",
    "head",
    "mv",
    "sed",
  ]);
});

afterAll(() => {
  rmSync(pathWithoutJq, { recursive: true, force: true });
});

beforeEach(() => {
  sandbox = new GitSandbox();
});

afterEach(() => {
  sandbox.remove();
});

const toolInput = (command: string) =>
  JSON.stringify({ tool_input: { command } });

function hook(
  script: string,
  stdin: string,
  env: NodeJS.ProcessEnv = {},
  unsetEnv: readonly string[] = [],
): Outcome {
  return sandbox.run(`.claude/hooks/${script}`, [], {
    stdin,
    env: { CLAUDE_PROJECT_DIR: sandbox.root, ...env },
    unsetEnv,
  });
}

/** The hook's decision: `allow` when it printed nothing, else its deny reason. */
function decision(
  outcome: Outcome,
): { allowed: true } | { allowed: false; reason: string } {
  expect(outcome.status).toBe(0);
  if (outcome.stdout.trim() === "") return { allowed: true };
  const parsed = JSON.parse(outcome.stdout) as {
    hookSpecificOutput: {
      permissionDecision: string;
      permissionDecisionReason: string;
    };
  };
  expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
  return {
    allowed: false,
    reason: parsed.hookSpecificOutput.permissionDecisionReason,
  };
}

describe.each(["pr-gate.sh", "protect-main.sh"])(
  "%s fails closed",
  (script) => {
    const command = script === "pr-gate.sh" ? "gh pr list" : "git status";

    it("allows a harmless command when jq reads it", () => {
      sandbox.git("switch", "--quiet", "--create", "feat/x");
      expect(decision(hook(script, toolInput(command)))).toEqual({
        allowed: true,
      });
    });

    it("denies every command when jq is not installed", () => {
      const result = decision(
        hook(script, toolInput(command), { PATH: pathWithoutJq }),
      );
      expect(result).toMatchObject({
        allowed: false,
        reason: expect.stringContaining("jq"),
      });
    });

    it("denies a tool input jq cannot read", () => {
      expect(decision(hook(script, '{"tool_input": '))).toMatchObject({
        allowed: false,
      });
    });
  },
);

describe("pr-gate.sh", () => {
  beforeEach(() => {
    sandbox.git("switch", "--quiet", "--create", "feat/working-model-p9-x");
  });

  it.each([
    "gh pr create --fill",
    "gh pr merge 31 --squash",
    "cd x && gh pr create",
  ])('denies "%s" without either stamp, naming both', (command) => {
    const result = decision(hook("pr-gate.sh", toolInput(command)));
    expect(result).toMatchObject({ allowed: false });
    if (result.allowed) return;
    expect(result.reason).toContain("the phase review has not approved HEAD");
    expect(result.reason).toContain("preflight has not passed on HEAD");
  });

  it("denies with the review stamp only, naming preflight alone", () => {
    sandbox.stamp("review-ok", [sandbox.head()]);
    const result = decision(hook("pr-gate.sh", toolInput("gh pr create")));
    expect(result).toMatchObject({ allowed: false });
    if (result.allowed) return;
    expect(result.reason).toContain("preflight has not passed on HEAD");
    expect(result.reason).not.toContain("the phase review");
  });

  it("denies with the preflight stamp only, naming the review alone", () => {
    sandbox.stamp("preflight-ok", [sandbox.head()]);
    const result = decision(hook("pr-gate.sh", toolInput("gh pr create")));
    expect(result).toMatchObject({ allowed: false });
    if (result.allowed) return;
    expect(result.reason).toContain("the phase review has not approved HEAD");
    expect(result.reason).not.toContain("preflight has not passed");
  });

  it("denies when both stamps are stale", () => {
    sandbox.stamp("review-ok", [sandbox.head()]);
    sandbox.stamp("preflight-ok", [sandbox.head()]);
    sandbox.commit("after the stamps");
    expect(
      decision(hook("pr-gate.sh", toolInput("gh pr create"))),
    ).toMatchObject({
      allowed: false,
    });
  });

  it("allows when HEAD is in both stamps", () => {
    sandbox.stamp("review-ok", [sandbox.head()]);
    sandbox.stamp("preflight-ok", ["a".repeat(40), sandbox.head()]);
    expect(decision(hook("pr-gate.sh", toolInput("gh pr create")))).toEqual({
      allowed: true,
    });
  });

  it("ignores a gh command that opens or merges no PR", () => {
    expect(decision(hook("pr-gate.sh", toolInput("gh pr view 31")))).toEqual({
      allowed: true,
    });
  });

  it("denies a command that only mentions gh pr create, rather than parse the shell", () => {
    expect(
      decision(hook("pr-gate.sh", toolInput("echo gh pr create"))),
    ).toMatchObject({
      allowed: false,
    });
  });
});

describe("protect-main.sh", () => {
  it.each([
    "git commit -m x",
    "git merge feat/x",
    "git -C . rebase main",
    "git push",
  ])('denies "%s" on main', (command) => {
    expect(decision(hook("protect-main.sh", toolInput(command)))).toMatchObject(
      {
        allowed: false,
      },
    );
  });

  it.each([
    "git push origin main",
    "git push origin HEAD:main",
    "git push -u origin main",
  ])('denies "%s" from a branch', (command) => {
    sandbox.git("switch", "--quiet", "--create", "feat/x");
    expect(decision(hook("protect-main.sh", toolInput(command)))).toMatchObject(
      {
        allowed: false,
      },
    );
  });

  it.each([
    'git commit -m "merge main into the plan"',
    "git push -u origin feat/x",
    "git log main..HEAD && git push origin feat/x",
  ])('allows "%s" on a branch', (command) => {
    sandbox.git("switch", "--quiet", "--create", "feat/x");
    expect(decision(hook("protect-main.sh", toolInput(command)))).toEqual({
      allowed: true,
    });
  });
});

describe("protect-main.sh and the private notebook", () => {
  it.each([
    'git -C .work commit -m "docs(plan): tick 1.2"',
    "git -C .work push origin main",
    "git -C .work/ commit -am x",
    "git -C /Users/someone/code/repo/.work push -u origin main",
  ])('allows "%s" on main', (command) => {
    expect(decision(hook("protect-main.sh", toolInput(command)))).toEqual({
      allowed: true,
    });
  });

  it.each([
    "git -C .work commit -m x && git commit -m y",
    "git -C my.work commit -m x",
    "git -C .workshop push origin main",
    // A second -C, or --git-dir and --work-tree, point git back at this
    // repository: only `git -C <…/.work> <subcommand>` is the notebook.
    "git -C .work -C .. commit -m x",
    "git -C .work -C .. push origin main",
    "git -C .work --git-dir=../.git --work-tree=.. commit -m x",
  ])('denies "%s" on main', (command) => {
    expect(decision(hook("protect-main.sh", toolInput(command)))).toMatchObject(
      {
        allowed: false,
      },
    );
  });
});

describe("protect-main.sh and git's global options", () => {
  it.each([
    "git -c user.name=x commit -m x",
    "git -c core.hooksPath=/dev/null commit -m x",
    "git --no-pager commit -m x",
    "git --git-dir ../.git commit -m x",
    "git --git-dir=.git --work-tree=. merge feat/x",
    "git -c k=v push",
    // No list of git's options: any long option may take one argument.
    "git --attr-source HEAD commit -m x",
    'git -c "user.name=a b" commit -m x',
    "git -c 'user.name=a b' commit -m x",
  ])('denies "%s" on main', (command) => {
    expect(decision(hook("protect-main.sh", toolInput(command)))).toMatchObject(
      {
        allowed: false,
      },
    );
  });

  it.each([
    "git -c k=v push origin main",
    "git --no-pager push origin HEAD:main",
    // Every push of a compound command is judged, and a forced refspec too.
    "git push origin feat/x && git push origin main",
    "git -c k=v push origin +main",
    "git push origin +HEAD:main",
  ])('denies "%s" from a branch', (command) => {
    sandbox.git("switch", "--quiet", "--create", "feat/x");
    expect(decision(hook("protect-main.sh", toolInput(command)))).toMatchObject(
      {
        allowed: false,
      },
    );
  });

  it.each([
    "git -c user.name=x commit -m x",
    "git --no-pager log main..HEAD",
    'git -c k=v commit -m "push to main later"',
  ])('allows "%s" on a branch', (command) => {
    sandbox.git("switch", "--quiet", "--create", "feat/x");
    expect(decision(hook("protect-main.sh", toolInput(command)))).toEqual({
      allowed: true,
    });
  });
});

describe("protect-main.sh without CLAUDE_PROJECT_DIR", () => {
  it("judges the branch of the working directory and denies a commit on main", () => {
    // PWD is removed too, so bash sets it from the child's real working directory
    // (the sandbox) instead of inheriting the test runner's.
    const outcome = hook("protect-main.sh", toolInput("git commit -m x"), {}, [
      "CLAUDE_PROJECT_DIR",
      "PWD",
    ]);
    expect(decision(outcome)).toMatchObject({ allowed: false });
  });
});
