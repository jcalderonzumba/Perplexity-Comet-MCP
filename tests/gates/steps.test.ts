import { describe, expect, it } from "vitest";

import { CHECK_STEPS } from "../../scripts/lib/steps.mjs";

describe("CHECK_STEPS", () => {
  it("lints, typechecks both projects and runs every test, in that order", () => {
    expect(
      CHECK_STEPS.map((step) => [step.title, step.command, step.args]),
    ).toEqual([
      [
        "Lint and format (Biome)",
        "npx",
        ["--no-install", "biome", "check", "."],
      ],
      ["Typecheck (src)", "npx", ["--no-install", "tsc", "--noEmit"]],
      [
        "Typecheck (tests and scripts)",
        "npx",
        ["--no-install", "tsc", "--noEmit", "-p", "tsconfig.tools.json"],
      ],
      ["Tests", "npx", ["--no-install", "vitest", "run"]],
    ]);
  });
});
