/**
 * A `CLAUDE.md` or `CLAUDE.local.md` anywhere in the repository would replace
 * `AGENTS.md` for Claude Code and every subagent (spec D1), so none may exist,
 * committed or untracked.
 */
import { existsSync } from "node:fs";
import { basename, join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, runProcess } from "./support/git-sandbox.ts";

describe("the instruction file", () => {
  it("is AGENTS.md, at the root", () => {
    expect(existsSync(join(repoRoot, "AGENTS.md"))).toBe(true);
  });

  it("has no CLAUDE.md or CLAUDE.local.md beside it anywhere", () => {
    const listed = runProcess(
      "git",
      ["-C", repoRoot, "ls-files", "--cached", "--others", "--exclude-standard"],
    );
    expect(listed.status).toBe(0);
    const shadows = listed.stdout
      .split("\n")
      .filter((path) => ["CLAUDE.md", "CLAUDE.local.md"].includes(basename(path)));
    expect(shadows).toEqual([]);
  });
});
