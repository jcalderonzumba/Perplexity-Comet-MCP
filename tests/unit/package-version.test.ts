import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { packageVersion } from "../../src/package-version.js";

describe("packageVersion", () => {
  it("is the version in package.json, so no adapter hard-codes a release", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const { version } = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as { version: string };

    expect(packageVersion()).toBe(version);
  });
});
