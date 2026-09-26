import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { errorMessage } from "../../src/error-message.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

function sourceFiles(directory = SRC): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(directory, entry.name))
      : [join(directory, entry.name)],
  );
}

describe("errorMessage", () => {
  it("is an error's own message", () => {
    expect(errorMessage(new TypeError("Target closed"))).toBe("Target closed");
  });

  it("is the text of anything else thrown", () => {
    expect(errorMessage("socket hang up")).toBe("socket hang up");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(undefined)).toBe("undefined");
  });

  it("is the one helper of its kind in src/", () => {
    const helper =
      /function\s+\w+\(\s*error:\s*unknown\s*\):\s*string\s*\{\s*return error instanceof Error/;
    const defining = sourceFiles()
      .filter((file) => helper.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(SRC.length + 1));

    expect(defining).toEqual(["error-message.ts"]);
  });
});
