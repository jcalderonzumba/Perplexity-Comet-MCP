/**
 * `.git-blame-ignore-revs` may list only commits on HEAD's history (spec
 * D13). A squash merge keeps a branch's own commits off `main`, and a sha
 * that never reached `main` hides nothing from `git blame` there. The guard
 * reads the file as `git blame --ignore-revs-file` does, so an entry git would
 * refuse fails it too, and one git accepts is checked against the history.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  GIT_HEAVY_TEST_MS,
  GitSandbox,
  repoRoot,
  runProcess,
} from "./support/git-sandbox.ts";

const IGNORE_FILE_NAME = ".git-blame-ignore-revs";

/** What the guard finds wrong with an ignore file's entries. */
type Verdict = {
  /** Entries `git blame` cannot read as an object name, so it refuses the file. */
  readonly invalid: readonly string[];
  /** Full object names that are not HEAD or one of its ancestors. */
  readonly offHistory: readonly string[];
};

const CLEAN: Verdict = { invalid: [], offHistory: [] };

/**
 * The file's entries as git reads them: each line cut at its first `#`, then
 * trimmed; the lines left empty (comments and blank lines) are skipped.
 */
function listedEntries(ignoreFile: string): string[] {
  if (!existsSync(ignoreFile)) return [];
  return readFileSync(ignoreFile, "utf8")
    .split("\n")
    .map((line) => line.split("#", 1)[0].trim())
    .filter((entry) => entry !== "");
}

/**
 * True when `entry` is a full 40-character hex object name, the only form
 * `git blame --ignore-revs-file` accepts: it refuses the whole file on a short
 * sha, a ref name or trailing text.
 */
function isFullObjectName(entry: string): boolean {
  return /^[0-9a-f]{40}$/i.test(entry);
}

/** True when `sha` is HEAD or one of its ancestors; false when it is not, or is no commit here. */
function onHeadHistory(repo: string, sha: string): boolean {
  const outcome = runProcess("git", [
    "-C",
    repo,
    "merge-base",
    "--is-ancestor",
    sha,
    "HEAD",
  ]);
  return outcome.status === 0;
}

/** Judges `ignoreFile` against the history of the repository at `repo`. */
function judgeIgnoreFile(repo: string, ignoreFile: string): Verdict {
  const entries = listedEntries(ignoreFile);
  return {
    invalid: entries.filter((entry) => !isFullObjectName(entry)),
    offHistory: entries
      .filter(isFullObjectName)
      .filter((sha) => !onHeadHistory(repo, sha)),
  };
}

describe(".git-blame-ignore-revs", () => {
  it("lists only full object names of commits on HEAD's history", () => {
    expect(judgeIgnoreFile(repoRoot, join(repoRoot, IGNORE_FILE_NAME))).toEqual(
      CLEAN,
    );
  });
});

/** The commits a case's file names. */
type Commits = {
  /** HEAD of the sandbox's `main`. */
  readonly onHistory: string;
  /** A commit on a side branch that `main` never merged. */
  readonly offHistory: string;
};

type FileCase = {
  readonly name: string;
  readonly contents: (commits: Commits) => string;
  readonly verdict: (commits: Commits) => Verdict;
};

const FILE_CASES: readonly FileCase[] = [
  {
    name: "a short sha",
    contents: ({ onHistory }) => `${onHistory.slice(0, 7)}\n`,
    verdict: ({ onHistory }) => ({
      invalid: [onHistory.slice(0, 7)],
      offHistory: [],
    }),
  },
  {
    name: "a ref name",
    contents: () => "main\n",
    verdict: () => ({ invalid: ["main"], offHistory: [] }),
  },
  {
    name: "a full sha followed by a comment",
    contents: ({ onHistory }) => `${onHistory} # Biome reformat\n`,
    verdict: () => CLEAN,
  },
  {
    name: "a full sha followed by other text",
    contents: ({ onHistory }) => `${onHistory} reformat\n`,
    verdict: ({ onHistory }) => ({
      invalid: [`${onHistory} reformat`],
      offHistory: [],
    }),
  },
  {
    name: "a full sha in upper case",
    contents: ({ onHistory }) => `${onHistory.toUpperCase()}\n`,
    verdict: () => CLEAN,
  },
  {
    name: "a comment line",
    contents: () => "# Format-only commits\n",
    verdict: () => CLEAN,
  },
  {
    name: "a blank line",
    contents: ({ onHistory }) => `\n   \n${onHistory}\n`,
    verdict: () => CLEAN,
  },
  {
    name: "a full sha off HEAD's history",
    contents: ({ offHistory }) => `${offHistory}\n`,
    verdict: ({ offHistory }) => ({ invalid: [], offHistory: [offHistory] }),
  },
];

/** True when `git blame` reads `ignoreFile` without refusing it. */
function gitBlameReads(repo: string, ignoreFile: string): boolean {
  const outcome = runProcess("git", [
    "-C",
    repo,
    "blame",
    "--ignore-revs-file",
    ignoreFile,
    "change.txt",
  ]);
  return outcome.status === 0;
}

describe("the blame-ignore guard reads the file as git blame does", {
  timeout: GIT_HEAVY_TEST_MS,
}, () => {
  let sandbox: GitSandbox;
  let commits: Commits;
  let ignoreFile: string;

  beforeAll(() => {
    sandbox = new GitSandbox();
    sandbox.git("switch", "--quiet", "--create", "side");
    const offHistory = sandbox.commit("never merged");
    sandbox.git("switch", "--quiet", "main");
    commits = { onHistory: sandbox.commit("listed"), offHistory };
    ignoreFile = join(sandbox.root, IGNORE_FILE_NAME);
  });

  afterAll(() => sandbox.remove());

  it.each(FILE_CASES)("judges $name as git blame does", (fileCase) => {
    writeFileSync(ignoreFile, fileCase.contents(commits));
    const expected = fileCase.verdict(commits);

    expect(judgeIgnoreFile(sandbox.root, ignoreFile)).toEqual(expected);
    expect(gitBlameReads(sandbox.root, ignoreFile)).toBe(
      expected.invalid.length === 0,
    );
  });

  it("lists nothing when the file is missing", () => {
    const missing = join(sandbox.root, "no-such-ignore-file");

    expect(judgeIgnoreFile(sandbox.root, missing)).toEqual(CLEAN);
  });
});
