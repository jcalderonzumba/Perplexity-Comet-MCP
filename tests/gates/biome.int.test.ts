/**
 * Biome checks the public repository only: the private notebook `.work/`, the
 * build output `dist/` and `node_modules/` are git-ignored, and Biome must
 * ignore them too, or a notebook edit would fail the public gate.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { repoRoot, runProcess } from "./support/git-sandbox.ts";

const BADLY_FORMATTED = "export   const x={a:1}\n";
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "comet-mcp-biome-"));
  runProcess("git", ["-C", root, "init", "--quiet"]);
  cpSync(join(repoRoot, "biome.json"), join(root, "biome.json"));
  cpSync(join(repoRoot, ".gitignore"), join(root, ".gitignore"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "ok.ts"), "export const x = { a: 1 };\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const biome = () =>
  runProcess(join(repoRoot, "node_modules", ".bin", "biome"), ["check", "."], {
    cwd: root,
  });

describe("biome check", () => {
  it("passes on formatted code", () => {
    expect(biome().status).toBe(0);
  });

  it("fails on badly formatted code it owns", () => {
    writeFileSync(join(root, "src", "bad.ts"), BADLY_FORMATTED);
    expect(biome().status).not.toBe(0);
  });

  it.each([".work", "dist", "node_modules"])("ignores %s/", (directory) => {
    mkdirSync(join(root, directory));
    writeFileSync(join(root, directory, "bad.ts"), BADLY_FORMATTED);
    expect(biome().status).toBe(0);
  });

  it("leaves package-lock.json to npm", () => {
    writeFileSync(
      join(root, "package-lock.json"),
      '{"lockfileVersion":3,   "packages":{}}\n',
    );
    expect(biome().status).toBe(0);
  });
});
