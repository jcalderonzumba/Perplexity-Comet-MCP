#!/usr/bin/env node
/**
 * `npm run preflight` - the per-PR gate (AGENTS.md workflow step 6).
 *
 * Everything `npm run check` does, then a clean build, the package's contents,
 * and the live no-pro battery against the local Comet. Each step is named and
 * fails on its own, and every step runs even after one fails, so one run lists
 * everything wrong.
 *
 * Run it once, on the final commit, after `/review-phase` approved it. On
 * success it adds the commit to `.git/preflight-ok`; `.githooks/pre-push` and
 * `.claude/hooks/pr-gate.sh` refuse the push and the PR unless HEAD is listed
 * there and in `.git/review-ok`. Both this repository and the notebook `.work/`
 * (when the clone has one) must be clean, before and after.
 *
 * Flags:
 *   --allow-dirty   run the battery on dirty trees without stamping.
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import { capture, fail, Gate, ok, repoRoot, run, warn } from "./lib/gate.mjs";
import {
  dirtyTrees,
  LIVE_BATTERY_TIMEOUT_MS,
  packProblems,
} from "./lib/preflight-rules.mjs";
import { addStamp } from "./lib/stamps.mjs";
import { CHECK_STEPS } from "./lib/steps.mjs";

const allowDirty = process.argv.includes("--allow-dirty");
const notebook = join(repoRoot, ".work");

function currentDirt() {
  return dirtyTrees({
    public: capture("git", ["status", "--porcelain"]),
    work: existsSync(notebook)
      ? capture("git", ["-C", notebook, "status", "--porcelain"])
      : null,
  });
}

const dirt = currentDirt();
if (dirt.length > 0 && !allowDirty) {
  fail("uncommitted changes");
  process.stderr.write(
    "\npreflight stamps a commit, so it must run on clean trees.\n" +
      "Commit your work and rerun, or use --allow-dirty to run the battery\n" +
      `without producing a stamp.\n\n${dirt.join("\n\n")}\n`,
  );
  process.exit(1);
}

const gate = new Gate("npm run preflight");

for (const step of CHECK_STEPS)
  gate.step(step.title, () => run(step.command, step.args));
gate.step("Clean build", () => {
  rmSync(join(repoRoot, "dist"), { recursive: true, force: true });
  return run("npx", ["--no-install", "tsc"]);
});
gate.step("Package contents", () => {
  const json = capture("npm", [
    "pack",
    "--dry-run",
    "--json",
    "--ignore-scripts",
  ]);
  if (json === "") {
    fail("npm pack --dry-run failed");
    return 1;
  }
  /** @type {{ files: { path: string }[] }[]} */
  const packed = JSON.parse(json);
  const problems = packProblems(packed[0].files.map((file) => file.path));
  for (const problem of problems) fail(problem);
  return problems.length === 0 ? 0 : 1;
});
gate.step("Live no-pro battery (local Comet)", () =>
  run("node", ["tests/run-no-pro.mjs"], { timeoutMs: LIVE_BATTERY_TIMEOUT_MS }),
);
if (!allowDirty) {
  gate.step("Trees still clean", () => {
    const after = currentDirt();
    for (const tree of after) fail(tree);
    return after.length === 0 ? 0 : 1;
  });
}

gate.finish(() => {
  if (allowDirty) {
    warn(
      "--allow-dirty: no stamp written, the push and PR hooks will still refuse",
    );
    return;
  }
  const head = capture("git", ["rev-parse", "HEAD"]).trim();
  addStamp(join(repoRoot, ".git", "preflight-ok"), head);
  ok(`added ${head} to .git/preflight-ok`);
});
