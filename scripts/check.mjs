#!/usr/bin/env node
/**
 * `npm run check` - the per-commit gate (AGENTS.md workflow step 4). There is
 * no hosted CI (spec D3), so it runs locally before every commit: lint and
 * format, both typechecks, and every unit and integration test. The package
 * is small enough that it always runs everything. `npm run preflight` is the
 * per-PR gate.
 */
import { Gate, run } from "./lib/gate.mjs";
import { CHECK_STEPS } from "./lib/steps.mjs";

const gate = new Gate("npm run check");
for (const step of CHECK_STEPS)
  gate.step(step.title, () => run(step.command, step.args));
gate.finish();
