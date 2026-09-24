/** There is no hosted CI (spec D3): the gates are local, and no workflow may creep back in. */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot } from "./support/git-sandbox.ts";

describe("hosted CI", () => {
  it("has no GitHub Actions workflows", () => {
    expect(existsSync(join(repoRoot, ".github", "workflows"))).toBe(false);
  });
});
