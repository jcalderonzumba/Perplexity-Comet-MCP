/**
 * `.git-blame-ignore-revs` may list only commits on HEAD's history (spec
 * D13). A squash merge keeps a branch's own commits off `main`, and a sha
 * that never reached `main` hides nothing from `git blame` there.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, runProcess } from "./support/git-sandbox.ts";

const IGNORE_FILE = join(repoRoot, ".git-blame-ignore-revs");

/** The shas the file lists, without its comment and blank lines. */
function listedShas(): string[] {
  if (!existsSync(IGNORE_FILE)) return [];
  return readFileSync(IGNORE_FILE, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/** True when `sha` is HEAD or one of its ancestors; false when it is not, or is no commit here. */
function onHeadHistory(sha: string): boolean {
  const outcome = runProcess("git", [
    "-C",
    repoRoot,
    "merge-base",
    "--is-ancestor",
    sha,
    "HEAD",
  ]);
  return outcome.status === 0;
}

describe(".git-blame-ignore-revs", () => {
  it("lists only commits on HEAD's history", () => {
    expect(listedShas().filter((sha) => !onHeadHistory(sha))).toEqual([]);
  });
});
