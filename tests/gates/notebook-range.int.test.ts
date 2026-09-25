/**
 * `scripts/notebook-range.mjs`, run as `/review-phase` §3 runs it, in a
 * throwaway public clone holding a copy of `scripts/`, with a notebook
 * repository nested at `.work/`. Every commit and the branch's creation carry
 * a fixed time, so a test states which second each one happened in.
 */
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  GitSandbox,
  type Outcome,
  repoRoot,
  runProcess,
} from "./support/git-sandbox.ts";

/** Each test runs several git commands, slow when the whole suite runs at once. */
const GIT_HEAVY_TEST_MS = 30_000;
const BRANCH = "feat/demo-p1-range";
/** The second the branch is created in; the other times are relative to it. */
const CREATED = 1_800_000_000;

/** Runs git in `directory` as if the clock read `second`. */
function gitAt(second: number, directory: string, ...args: string[]): string {
  const date = `@${second} +0000`;
  const outcome = runProcess("git", ["-C", directory, ...args], {
    env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
  if (outcome.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${outcome.stderr}`);
  return outcome.stdout.trim();
}

class RangeSandbox {
  readonly repository = new GitSandbox();
  #notebookCommits = 0;

  constructor() {
    cpSync(join(repoRoot, "scripts"), join(this.root, "scripts"), {
      recursive: true,
    });
    writeFileSync(join(this.root, ".gitignore"), ".work/\n");
    gitAt(CREATED - 1_000, this.root, "add", "--all");
    gitAt(CREATED - 1_000, this.root, "commit", "--quiet", "-m", "scripts");
  }

  get root(): string {
    return this.repository.root;
  }

  get notebook(): string {
    return join(this.root, ".work");
  }

  addNotebook(): void {
    gitAt(CREATED - 1_000, this.root, "init", "--quiet", this.notebook);
  }

  /** Commits in the notebook at `second` and returns the short sha. */
  notebookCommit(second: number): string {
    this.#notebookCommits += 1;
    writeFileSync(join(this.notebook, "plan.md"), `${this.#notebookCommits}\n`);
    gitAt(second, this.notebook, "add", "--all");
    gitAt(second, this.notebook, "commit", "--quiet", "-m", "tick");
    return gitAt(second, this.notebook, "rev-parse", "--short", "HEAD");
  }

  createBranch(second: number): void {
    gitAt(second, this.root, "switch", "--quiet", "--create", BRANCH);
  }

  publicCommit(second: number): void {
    writeFileSync(join(this.root, "change.txt"), `${second}\n`);
    gitAt(second, this.root, "add", "--all");
    gitAt(second, this.root, "commit", "--quiet", "-m", "change");
  }

  /** Writes `/run-phase`'s work list for the branch, starting at these shas. */
  writeRunState(startLine: string): void {
    const run = join(this.root, ".git", "run", BRANCH.replaceAll("/", "-"));
    mkdirSync(run, { recursive: true });
    writeFileSync(
      join(run, "work-list.md"),
      `# Run: plan — Phase 1\n\nBranch: ${BRANCH}\n${startLine}\n`,
    );
  }

  range(): Outcome {
    return runProcess(process.execPath, ["scripts/notebook-range.mjs"], {
      cwd: this.root,
    });
  }

  remove(): void {
    this.repository.remove();
  }
}

let sandbox: RangeSandbox;

beforeEach(() => {
  sandbox = new RangeSandbox();
});

afterEach(() => {
  sandbox.remove();
});

describe("the notebook range", { timeout: GIT_HEAVY_TEST_MS }, () => {
  it("starts at the work list's Start when /run-phase keeps a run state", () => {
    sandbox.addNotebook();
    sandbox.notebookCommit(CREATED - 300);
    const start = sandbox.notebookCommit(CREATED - 200);
    const head = sandbox.notebookCommit(CREATED - 100);
    sandbox.createBranch(CREATED);
    sandbox.writeRunState(
      `Start: public abc1234 · work ${start}, both when this list was written`,
    );

    const outcome = sandbox.range();
    expect(outcome.stderr).toBe("");
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toBe(`${start}..${head}\n`);
  });

  it("holds a notebook commit made in the same second as the branch's first public commit", () => {
    sandbox.addNotebook();
    const before = sandbox.notebookCommit(CREATED - 100);
    sandbox.createBranch(CREATED);
    sandbox.publicCommit(CREATED);
    const tick = sandbox.notebookCommit(CREATED);

    const outcome = sandbox.range();
    expect(outcome.stderr).toBe("");
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toBe(`${before}..${tick}\n`);
  });

  it("leaves out a notebook commit made before the branch was created", () => {
    sandbox.addNotebook();
    sandbox.notebookCommit(CREATED - 100);
    const lastBefore = sandbox.notebookCommit(CREATED - 50);
    sandbox.createBranch(CREATED);
    sandbox.publicCommit(CREATED + 10);
    const tick = sandbox.notebookCommit(CREATED + 20);

    const outcome = sandbox.range();
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toBe(`${lastBefore}..${tick}\n`);
  });

  it("prints nothing in a clone without .work/", () => {
    sandbox.createBranch(CREATED);

    const outcome = sandbox.range();
    expect(outcome).toEqual({ status: 0, stdout: "", stderr: "" });
  });

  it("fails clearly when .work/ is not a git repository", () => {
    mkdirSync(sandbox.notebook);
    writeFileSync(join(sandbox.notebook, "plan.md"), "# Plan\n");
    sandbox.createBranch(CREATED);

    const outcome = sandbox.range();
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toBe("");
    expect(outcome.stderr).toContain(
      ".work/ exists but is not a readable git repository",
    );
  });

  it("fails clearly when the work list has no Start line", () => {
    sandbox.addNotebook();
    sandbox.notebookCommit(CREATED - 100);
    sandbox.createBranch(CREATED);
    sandbox.writeRunState("Started: yesterday");

    const outcome = sandbox.range();
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toBe("");
    expect(outcome.stderr).toContain("has no Start line");
  });

  it("fails clearly when the work list's Start is not a notebook commit", () => {
    sandbox.addNotebook();
    sandbox.notebookCommit(CREATED - 100);
    sandbox.createBranch(CREATED);
    sandbox.writeRunState("Start: public abc1234 · work 0000000, both");

    const outcome = sandbox.range();
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toBe("");
    expect(outcome.stderr).toContain("0000000");
  });

  it("fails clearly when no notebook commit precedes the branch", () => {
    sandbox.addNotebook();
    sandbox.createBranch(CREATED);
    sandbox.notebookCommit(CREATED + 10);

    const outcome = sandbox.range();
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toBe("");
    expect(outcome.stderr).toContain("no notebook commit precedes");
  });

  it("fails clearly on a detached HEAD", () => {
    sandbox.addNotebook();
    sandbox.notebookCommit(CREATED - 100);
    gitAt(CREATED, sandbox.root, "switch", "--quiet", "--detach");

    const outcome = sandbox.range();
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toBe("");
    expect(outcome.stderr).toContain("detached");
  });
});
