/**
 * The instruction files agents read (`AGENTS.md` and every Markdown file under
 * `.claude/`): ported from learn-play, they must carry none of its project
 * rules, and every relative link in them must lead to a file and heading that
 * exist in this public repository, never into the private `.work/`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot } from "./support/git-sandbox.ts";

function markdownUnder(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return markdownUnder(path);
    return name.endsWith(".md") ? [path] : [];
  });
}

const files = [
  join(repoRoot, "AGENTS.md"),
  ...markdownUnder(join(repoRoot, ".claude")),
];

/** GitHub's heading anchor: lower case, punctuation dropped, spaces to hyphens. */
function anchorOf(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^\p{L}\p{N} -]/gu, "")
    .replace(/ /g, "-");
}

function anchorsIn(path: string): Set<string> {
  const headings = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => /^#{1,6} /.test(line))
    .map((line) => anchorOf(line.replace(/^#{1,6} /, "")));
  return new Set(headings);
}

// Payload is matched as the CMS name only: "payloads" of HTTP requests are not a leftover.
const LEFTOVERS =
  /colonia|children|pnpm|godot|gdscript|drizzle|fastify|docs\/superpowers|docs\/research|\bprd\b/i;
const CASE_SENSITIVE_LEFTOVERS = /\bPayload\b/;

describe("anchorOf", () => {
  it("follows GitHub's rule", () => {
    expect(anchorOf("Check 3: Outside facts")).toBe("check-3-outside-facts");
    expect(anchorOf("Workflow (every change, no exceptions)")).toBe(
      "workflow-every-change-no-exceptions",
    );
    expect(anchorOf("`AGENTS.md` and the checks")).toBe(
      "agentsmd-and-the-checks",
    );
  });
});

describe.each(files.map((path) => [relative(repoRoot, path), path]))(
  "%s",
  (_name, path) => {
    const text = readFileSync(path, "utf8");

    it("carries no learn-play project rule", () => {
      const hits = text
        .split("\n")
        .filter(
          (line) => LEFTOVERS.test(line) || CASE_SENSITIVE_LEFTOVERS.test(line),
        );
      expect(hits).toEqual([]);
    });

    it("links only to files and headings that exist, never into .work/", () => {
      const links = [...text.matchAll(/\]\(([^)\s]+)\)/g)]
        .map((match) => match[1])
        .filter((target) => !/^[a-z]+:/i.test(target));
      for (const target of links) {
        const [file, anchor] = target.split("#");
        const destination = file === "" ? path : resolve(dirname(path), file);
        expect(
          relative(repoRoot, destination).startsWith(".work"),
          target,
        ).toBe(false);
        expect(existsSync(destination), target).toBe(true);
        if (anchor !== undefined && destination.endsWith(".md")) {
          expect(anchorsIn(destination).has(anchor), target).toBe(true);
        }
      }
    });
  },
);
