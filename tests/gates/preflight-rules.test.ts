import { describe, expect, it } from "vitest";

import {
  dirtyTrees,
  packProblems,
} from "../../scripts/lib/preflight-rules.mjs";

describe("packProblems", () => {
  const good = [
    "package.json",
    "README.md",
    "LICENSE",
    "dist/index.js",
    "dist/index.d.ts",
  ];

  it("accepts the build, the manifest, the README and the licence", () => {
    expect(packProblems(good)).toEqual([]);
  });

  it("names every file that should not ship", () => {
    expect(
      packProblems([
        ...good,
        "src/index.ts",
        "tests/unit/smoke.test.ts",
        ".work/x.md",
      ]),
    ).toEqual([
      "unexpected in the tarball: src/index.ts",
      "unexpected in the tarball: tests/unit/smoke.test.ts",
      "unexpected in the tarball: .work/x.md",
    ]);
  });

  it("names every required file that is missing", () => {
    expect(packProblems(["package.json", "dist/other.js"])).toEqual([
      "missing from the tarball: dist/index.js",
      "missing from the tarball: README.md",
      "missing from the tarball: LICENSE",
    ]);
  });
});

describe("dirtyTrees", () => {
  it("is empty when both trees are clean", () => {
    expect(dirtyTrees({ public: "", work: "" })).toEqual([]);
  });

  it("works in a clone without the notebook", () => {
    expect(dirtyTrees({ public: "", work: null })).toEqual([]);
    expect(dirtyTrees({ public: " M src/index.ts\n", work: null })).toEqual([
      "the working tree:\n M src/index.ts",
    ]);
  });

  it("refuses a dirty notebook, an uncommitted plan tick included", () => {
    expect(dirtyTrees({ public: "", work: " M plans/x.md\n" })).toEqual([
      ".work/:\n M plans/x.md",
    ]);
  });
});
