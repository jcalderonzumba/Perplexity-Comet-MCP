#!/usr/bin/env node
/**
 * Prints the notebook commits that belong to the current branch, as the range
 * `<base>..<head>` of the nested `.work/` repository, for `/review-phase`'s
 * review brief.
 *
 * The base is the work list's *Start* when `/run-phase` keeps a run state for
 * the branch (`.git/run/<branch>/work-list.md`). Without one, it is the last
 * notebook commit made before the branch was created, a time read from the
 * branch's reflog. Commit times have a one-second grain, so a notebook commit
 * made in the second the branch was created counts as the branch's.
 *
 * Prints nothing in a clone without `.work/`. Fails, saying why, when `.work/`
 * is not a readable repository or the base cannot be found, so a failed read
 * never passes for an empty range.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { capture, repoRoot } from "./lib/gate.mjs";

const notebook = join(repoRoot, ".work");

/** @param {string[]} args */
const publicGit = (...args) => capture("git", args).trim();

/**
 * Git in the notebook. Git would otherwise walk up from a `.work/` that is not
 * a repository to the public one and answer for it.
 * @param {string[]} args
 */
const notebookGit = (...args) =>
  capture("git", ["-C", notebook, ...args], {
    env: { GIT_CEILING_DIRECTORIES: repoRoot },
  }).trim();

/** @param {string} revision */
const notebookCommit = (revision) =>
  notebookGit("rev-parse", "--short", "--verify", `${revision}^{commit}`);

function notebookHead() {
  try {
    return notebookCommit("HEAD");
  } catch (error) {
    throw new Error(
      `.work/ exists but is not a readable git repository: ${messageOf(error)}`,
    );
  }
}

function currentBranch() {
  const branch = publicGit("branch", "--show-current");
  if (branch === "")
    throw new Error("HEAD is detached; the notebook range belongs to a branch");
  return branch;
}

/**
 * The notebook sha on the work list's *Start* line, or null when `/run-phase`
 * keeps no run state for the branch.
 * @param {string} branch
 * @returns {string | null}
 */
function runStateStart(branch) {
  const gitDir = publicGit("rev-parse", "--absolute-git-dir");
  const workList = join(
    gitDir,
    "run",
    branch.replaceAll("/", "-"),
    "work-list.md",
  );
  if (!existsSync(workList)) return null;
  const start = /^Start: public \S+ · work ([0-9a-f]+)/m.exec(
    readFileSync(workList, "utf8"),
  );
  if (start === null)
    throw new Error(
      `${workList} has no Start line ("Start: public <sha> · work <sha>")`,
    );
  return start[1];
}

/**
 * When the branch was created, in seconds since the epoch: the time of its
 * oldest reflog entry.
 * @param {string} branch
 */
function branchCreatedAt(branch) {
  const selectors = publicGit(
    "reflog",
    "show",
    "--date=unix",
    "--format=%gd",
    `refs/heads/${branch}`,
  ).split("\n");
  const oldest = /@\{(\d+)\}$/.exec(selectors.at(-1) ?? "");
  if (oldest === null)
    throw new Error(`${branch} has no reflog to tell when it was created`);
  return Number(oldest[1]);
}

/** @param {string} branch */
function lastNotebookCommitBefore(branch) {
  const createdAt = branchCreatedAt(branch);
  const base = notebookGit(
    "rev-list",
    "-1",
    `--before=@${createdAt - 1}`,
    "HEAD",
  );
  if (base === "")
    throw new Error(`no notebook commit precedes the creation of ${branch}`);
  return notebookCommit(base);
}

/** @returns {string | null} the range, or null in a clone without `.work/` */
function notebookRange() {
  if (!existsSync(notebook)) return null;
  const head = notebookHead();
  const branch = currentBranch();
  const start = runStateStart(branch);
  const base =
    start === null ? lastNotebookCommitBefore(branch) : notebookCommit(start);
  return `${base}..${head}`;
}

/** @param {unknown} error */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

try {
  const range = notebookRange();
  if (range !== null) process.stdout.write(`${range}\n`);
} catch (error) {
  process.stderr.write(`notebook-range: ${messageOf(error)}\n`);
  process.exit(1);
}
