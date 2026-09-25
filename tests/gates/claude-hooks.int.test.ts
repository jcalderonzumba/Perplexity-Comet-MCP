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

import {
  GIT_HEAVY_TEST_MS,
  GitSandbox,
  type Outcome,
  pathWith,
} from "./support/git-sandbox.ts";

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
  { timeout: GIT_HEAVY_TEST_MS },
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

describe("pr-gate.sh", { timeout: GIT_HEAVY_TEST_MS }, () => {
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

describe("protect-main.sh", { timeout: GIT_HEAVY_TEST_MS }, () => {
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

describe("protect-main.sh and the private notebook", {
  timeout: GIT_HEAVY_TEST_MS,
}, () => {
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

describe("protect-main.sh and git's global options", {
  timeout: GIT_HEAVY_TEST_MS,
}, () => {
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

describe("protect-main.sh and git's environment variables", {
  timeout: GIT_HEAVY_TEST_MS,
}, () => {
  it.each([
    "GIT_DIR=../.git GIT_WORK_TREE=.. git -C .work commit -m x",
    "GIT_WORK_TREE=.. git -C .work commit -m x",
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.worktree GIT_CONFIG_VALUE_0=.. git -C .work commit -m x",
    "GIT_CONFIG_PARAMETERS=\"'core.worktree'='..'\" git -C .work push origin main",
    // Any git variable, set anywhere before the notebook's git, not only these.
    "GIT_COMMON_DIR=../.git git -C .work commit -m x",
    "env GIT_DIR=../.git git -C .work commit -m x",
    "export GIT_DIR=../.git; git -C .work commit -m x",
    "export GIT_WORK_TREE=..\ngit -C .work commit -m x",
    // A variable read, not set, ends the exemption too: the hook cannot tell.
    "echo $GIT_DIR; git -C .work commit -m x",
  ])('denies "%s" on main', (command) => {
    expect(decision(hook("protect-main.sh", toolInput(command)))).toMatchObject(
      {
        allowed: false,
      },
    );
  });

  it.each([
    'git -C .work commit -m "docs: why GIT_DIR=.. is refused"',
    "git -C .work add plans && git -C .work commit -m x",
  ])('allows "%s" on main', (command) => {
    expect(decision(hook("protect-main.sh", toolInput(command)))).toEqual({
      allowed: true,
    });
  });
});

describe("protect-main.sh and quoted arguments", {
  timeout: GIT_HEAVY_TEST_MS,
}, () => {
  it.each([
    'git --git-dir "../a b/.git" commit -m x',
    'git --git-dir="../a b/.git" commit -m x',
    "git --git-dir '../a b/.git' merge feat/x",
    "git --work-tree='a b' commit -m x",
    "git --work-tree a\\ b commit -m x",
    "git --work-tree=a\\ b commit -m x",
    'git -C "a b" commit -m x',
    // A backslash-newline continues the shell line.
    "git \\\ncommit -m x",
    "git -c k=v \\\n  merge feat/x",
  ])('denies "%s" on main', (command) => {
    expect(decision(hook("protect-main.sh", toolInput(command)))).toMatchObject(
      {
        allowed: false,
      },
    );
  });

  it.each([
    'git push origin "main"',
    "git push origin 'main'",
    'git push origin "HEAD:main"',
    'git push origin HEAD:"main"',
    "git push origin '+main'",
    'git push origin "refs/heads/main"',
    'git --git-dir "../a b/.git" push origin feat/x:main',
    "(git push origin main)",
  ])('denies "%s" from a branch', (command) => {
    sandbox.git("switch", "--quiet", "--create", "feat/x");
    expect(decision(hook("protect-main.sh", toolInput(command)))).toMatchObject(
      {
        allowed: false,
      },
    );
  });

  it.each([
    'git push origin "feat/x"',
    "git push origin feat/main-fix",
    'git --git-dir "../a b/.git" push origin feat/x',
  ])('allows "%s" from a branch', (command) => {
    sandbox.git("switch", "--quiet", "--create", "feat/x");
    expect(decision(hook("protect-main.sh", toolInput(command)))).toEqual({
      allowed: true,
    });
  });
});

describe("protect-main.sh reads quoting as the shell does", {
  timeout: GIT_HEAVY_TEST_MS,
}, () => {
  it.each([
    // An escaped quote inside double quotes does not end the argument.
    'git -c "a=b\\" c" commit -m x',
    'git --work-tree="a\\" b" commit -m x',
    'git --git-dir "x\\" y" merge feat/x',
    'git -C "x\\" y" commit -m x',
    // ANSI-C quoting, where \' does not end the argument either.
    "git -c $'a\\' b' commit -m x",
    // A newline inside quotes is part of the argument.
    'git -c "user.name=a\nb" commit -m x',
    "git -c 'user.name=a\nb' commit -m x",
    // Quotes removed, the words are git and commit.
    '"git" commit -m x',
    "g'it' com\\mit -m x",
  ])('denies "%s" on main', (command) => {
    expect(decision(hook("protect-main.sh", toolInput(command)))).toMatchObject(
      {
        allowed: false,
      },
    );
  });

  it.each([
    'git -c "a\\" b" push origin main',
    'git -c "a\\" b" push origin "main"',
    'git -c "a\nb" push origin main',
    // A quoted or escaped ; & | is part of a word, not the end of the push.
    'git push origin "a;b" main',
    "git push origin a\\;b main",
    "git push origin 'a|b' main",
    // ANSI-C escapes are decoded: \x6d, \155 and m are all "m".
    "git push origin $'\\x6dain'",
    "git push origin $'\\155ain'",
    "git push origin $'\\u006dain'",
  ])('denies "%s" from a branch', (command) => {
    sandbox.git("switch", "--quiet", "--create", "feat/x");
    expect(decision(hook("protect-main.sh", toolInput(command)))).toMatchObject(
      {
        allowed: false,
      },
    );
  });

  it.each([
    'git commit -m "say \\"push to main\\" later"',
    "git commit -m $'it\\'s for main, not now'",
    "git push origin $'feat/x'",
    'git push origin "feat/x;y"',
  ])('allows "%s" on a branch', (command) => {
    sandbox.git("switch", "--quiet", "--create", "feat/x");
    expect(decision(hook("protect-main.sh", toolInput(command)))).toEqual({
      allowed: true,
    });
  });

  it.each([
    'git -C .work commit -m "say \\"hi\\" to main"',
    "git -C .work commit -m $'it\\'s done'",
    'git -C .work commit -m "two\nlines"',
  ])('allows the notebook\'s "%s" on main', (command) => {
    expect(decision(hook("protect-main.sh", toolInput(command)))).toEqual({
      allowed: true,
    });
  });
});

describe("protect-main.sh without CLAUDE_PROJECT_DIR", {
  timeout: GIT_HEAVY_TEST_MS,
}, () => {
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
