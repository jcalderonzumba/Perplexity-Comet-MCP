import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { addStamp, stampedShas } from "../../scripts/lib/stamps.mjs";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "comet-mcp-stamps-"));
  file = join(dir, "preflight-ok");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("stampedShas", () => {
  it("lists nothing when the stamp does not exist", () => {
    expect(stampedShas(file)).toEqual([]);
  });

  it("reads one sha per line, ignoring blank lines and spaces", () => {
    writeFileSync(file, "aaa\n\n  bbb \n");
    expect(stampedShas(file)).toEqual(["aaa", "bbb"]);
  });
});

describe("addStamp", () => {
  it("creates the stamp with the sha", () => {
    addStamp(file, "aaa");
    expect(readFileSync(file, "utf8")).toBe("aaa\n");
  });

  it("appends, keeping every other sha", () => {
    writeFileSync(file, "aaa\n");
    addStamp(file, "bbb");
    expect(readFileSync(file, "utf8")).toBe("aaa\nbbb\n");
  });

  it("adds a missing final newline before appending", () => {
    writeFileSync(file, "aaa");
    addStamp(file, "bbb");
    expect(readFileSync(file, "utf8")).toBe("aaa\nbbb\n");
  });

  it("never lists a sha twice", () => {
    writeFileSync(file, "aaa\n");
    addStamp(file, "aaa");
    expect(readFileSync(file, "utf8")).toBe("aaa\n");
  });
});
