---
name: review-plan
description: Review the current implementation plan of Perplexity Comet MCP against the design spec, its nine principles and three architecture boundaries, the code graph of what it changes, and the TypeScript, Node, security, MCP and TDD skill criteria, before any phase of it is built. Records the verdict in the plan's header.
---

# Plan Review Gate

Review the implementation plan currently in context in four phases, in order. Plans live under `.work/plans/` and the spec at `.work/specs/2026-09-23-comet-mcp-design.md`; open both by path, because search tools skip `.work/`.

Findings use three categories:

- **Must Fix** — blocks approval; structural, correctness, or principle violation
- **Should Fix** — recommended improvement; missed best practice
- **Consider** — optional; minor enhancement worth noting

Short-circuit rules stop the review early so a structurally broken plan never wastes a full battery run. If a referenced skill is unavailable, note "skill unavailable, skipped" in the summary and continue — never fail the review over a missing skill, and never silently drop a check: every skip appears in the final summary with its reason.

When a plan step names a specific API (an MCP SDK server, transport or schema call; a `chrome-remote-interface` method or a DevTools Protocol command or event; a Vitest API; a Biome configuration key), fetch current docs with Context7 before judging that step. Merely naming the library is not a trigger. Do not rely on memory for these; note in the summary which docs were fetched.

Two rules override every skill invoked below, **Decisions win** and **Stack wins**; they are stated in the rules section of [`spec-and-safety.md`](spec-and-safety.md).

## Phase 0: Spec & Safety (always runs first)

Apply every check in [`spec-and-safety.md`](spec-and-safety.md) — spec conformance, the nine principles, outside facts — using each check's *Plan trigger*. Any Must Fix is presented immediately and stops the review: request plan revision and skip all later phases.

## Phase 1: Code Graph Validation (CodeGraph)

Validate the plan against the actual codebase dependency graph. This catches structural gaps (missed callers, underestimated scope, untested flows) that qualitative review cannot detect. The graph is CodeGraph's (`.codegraph/` at the repo root, built by `codegraph init`, auto-synced on every edit); the checks below call its CLI through Bash and read the JSON, so they never depend on which MCP tools a session lists.

### Applicability gate

- **Skip entirely** when: plan only adds new files, config-only changes, or docs-only changes. Note in output: `Graph Validation: SKIPPED — plan only adds new code`
- **Skip with note** when: `.codegraph/` does not exist at the repo root. Note in output: `Graph Validation: SKIPPED — repo not indexed (run codegraph init)`. When more than one skip condition applies, list all of them.
- **Run only Check 2** when: plan adds new code that imports/calls existing symbols (verify the plan understands which flows the new code joins)
- **Run all checks** when: plan modifies, renames, deletes, or changes the signature of existing symbols

### Check 1: Blast radius validation

For each existing symbol the plan proposes to modify (max 10, prioritized by fan-in):

1. Run `codegraph callers <symbol> --json` for the direct dependents (d=1, WILL BREAK) and `codegraph impact <symbol> --depth 2 --json` for the union; d=2 (LIKELY AFFECTED) is the union minus d=1. Exclude the symbol's own members (the methods, properties and fields the impact list reports from the symbol's own definition). Run the commands in parallel across symbols
2. Compare d=1 and d=2 against the symbols the plan explicitly mentions updating
3. **Must Fix** — d=1 dependents the plan does not mention updating
4. **Should Fix** — d=2 dependents not mentioned when confidence is high

### Check 2: Affected execution flow and test audit

For each modified symbol:

1. Run `codegraph impact <symbol> --depth 4 --json` and keep the entry points it reaches: the tool handlers (the `comet_*` cases of `src/index.ts` and the `handle*` functions of `src/http-bridge.ts`), the bridge's request handler, and the two process entry points (`src/index.ts`, `src/http-bridge.ts`). Map each to a critical path by name
2. Run `codegraph affected <changed files...> --json` once over every file the plan modifies, for the existing test files the change reaches
3. Deduplicate flows and test files across all modified symbols
4. Cross-reference both lists against the plan's test strategy
5. **Must Fix** — critical-path flows not covered in the test plan. Critical paths: `comet_ask` from submission through completion detection to answer extraction (`src/comet-ai.ts`), connect and reconnect (`src/cdp-client.ts`), tab close protection (`comet_tabs` close), upload path validation (`src/upload-validator.ts` through `comet_upload`), the HTTP bridge's token check, and the UNTRUSTED wrapping of every page-derived result
6. **Should Fix** — non-critical flows not mentioned for testing when total affected flows > 2, or affected test files the plan neither runs nor updates

### Check 3: Cross-module detection

1. Map each modified symbol and each d=1 dependent to its module: the file under `src/` (the modules of spec §4.1), or `tests/`, `scripts/`, `.githooks/`, `.claude/`
2. Read the file paths from the Check 1 output; nothing else is needed
3. **Should Fix** — changes span 3+ modules without the plan acknowledging cross-module coordination
4. **Consider** — changes span 2 modules

### Check 4: Scope accuracy (conditional)

Only run if the plan states a scope estimate (file count, effort, or explicit file list):

1. Count total unique files at d=1 and d=2 from the Check 1 output
2. Compare against the plan's stated scope
3. **Must Fix** — empirical scope is more than 2x the plan's stated scope
4. **Should Fix** — empirical scope is 1.5–2x the stated scope

### Short-circuit

If Phase 1 produces any **Must Fix** findings, present them immediately and request plan revision **before** proceeding to Phase 2. Do not waste time on qualitative review for a structurally incomplete plan.

## Phase 2: Qualitative Skill Review

Invoke each skill using the Skill tool, then evaluate the plan against its criteria. Phase 0 and Phase 1 findings are included as context for every evaluation. Tiers run in order, with a short-circuit after Tier 1.

### Tier 1: Plan Quality (always)

1. `concise-planning` — validates plan structure: steps are atomic, verb-first, concrete, with exact file paths
2. `code-review-checklist` — baseline structural check across functionality, security, performance, tests, code quality
3. `kaizen` — error-proofing via types over runtime checks, YAGNI enforcement, standardized work patterns

**Short-circuit:** Must Fix here (non-atomic steps, missing file paths, symptom-fix without root cause) → present findings and request revision **before** Tier 2. File-path rule: a plan that modifies existing code must name the files; a plan that adds a module names the file and the directory it lives in.

### Tier 2: Core Technical (always)

1. `senior-architect` — architecture patterns, maintainability, dependency analysis
2. `architecture-patterns` — judged against the three boundaries of spec §4.2: one core and two adapters, validation at the edge, page code as tested functions with arguments
3. `typescript-expert` — type-level programming, strictness, TypeScript patterns
4. `nodejs-best-practices` — async patterns, process and child-process handling, Node.js security
5. `test-driven-development` — TDD compliance and test strategy; the unit and integration split of AGENTS.md *Tests*; the Pro battery named in the verification of any phase that touches ask, poll, mode or agentic behaviour
6. `lint-and-validate` — for a plan, verify that every phase's verification step runs `npm run check` and that `npm run preflight` gates the PR (no hosted CI, spec D3); nothing is executed during review

Skips (always noted): skip 1–2 when the plan is docs-only or pure scaffolding that introduces no module boundaries or data flows; skip 3–4 when the plan changes no TypeScript or JavaScript.

### Tier 3: Conditional (invoke only matching categories)

**Scaffolding rule:** a category is triggered only when the plan does real work in its area. Creating a directory, a config file or a placeholder for an area does not trigger its category; note the skip. Triggers match on the plan's title, goal or summary section and on the work its tasks describe, not on incidental words in the body.

| Category | Trigger | Skills |
|---|---|---|
| Security surface | Plan touches input validation (`src/upload-validator.ts`), `cometClient.evaluate` call sites, or the UNTRUSTED markers | `backend-security-coder`, `cc-skill-security-review`, `security-auditor`, `vulnerability-scanner` |
| HTTP bridge | Plan touches `src/http-bridge.ts`: auth, CORS, binding, routes | `api-security-best-practices`, `api-patterns`, `auth-implementation-patterns` |
| Page scripts | Plan adds or changes JavaScript run in the page | `frontend-security-coder`, `javascript-pro` |
| Tool contract | Plan adds or changes a tool, a parameter, a default or a result shape | `api-patterns`; Context7 for `@modelcontextprotocol/sdk` |
| CDP and the browser | Plan touches launch, connect, reconnect or tabs in `src/cdp-client.ts` | Context7 for `chrome-remote-interface` and the DevTools Protocol |
| Prompts to Comet | Plan changes prompt text or prompt shaping sent to Comet | `prompt-engineering` |
| Secrets | The work involves: secret, credential, token, key, env var, `.env` | `secrets-management` |
| Data leaving the machine | Plan touches logging, network requests, or adds a runtime dependency | `privacy-by-design` |
| Release | Plan is a release or publishes the package | `pre-release-review` |
| Bug fix | Plan title or goal section describes fixing a bug, regression or incident | `systematic-debugging` |
| The gates | Plan touches `.githooks/`, `.claude/hooks/`, `scripts/`, or the `check` and `preflight` scripts | `lint-and-validate` |

## Phase 3: Consolidated Review Summary

Present findings in three clearly separated sections:

1. **Spec & Safety** — Phase 0 findings (spec conformance, principles, outside facts)
2. **Code Graph Validation** — Phase 1 empirical findings (blast radius, affected flows and tests, cross-module, scope)
3. **Qualitative Review** — Phase 2 skill-evaluation findings

List every skipped check with its reason, every Context7 doc fetched and every research note checked. If Must Fix items exist in any section, the plan is **not approved**: revise the plan and re-review. Should Fix items must be resolved or explicitly deferred with a stated reason.

**Recording the verdict.** Count the rounds of this review on this plan. When a round reports no Must Fix, write the verdict into the plan's header as one line, replacing any earlier `**Review-plan verdict:**` line:

```markdown
**Review-plan verdict:** approved in round <n> on <YYYY-MM-DD>; Should Fix deferred: <each id with its reason, or "none">
```

and commit it in the notebook: `git -C .work commit -am "docs(plan): review-plan verdict for <plan file name>"`. `/run-phase` and `/review-phase` copy this line into the PR description.
