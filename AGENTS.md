# Perplexity Comet MCP

An MCP server that drives Perplexity's Comet browser over the Chrome DevTools Protocol, so Claude Code and other MCP clients can ask Comet questions, follow its browsing and read its answers. One owner plus Claude as the builder.

This file is the instructions for every agent working here, Claude Code's subagents included. The repository has no `CLAUDE.md` and must never get one, not even `.claude/CLAUDE.md`: Claude Code reads a `CLAUDE.md` instead of this file.

## Where truth lives

The design documents are private. They live in `.work/`, a git repository of its own nested in this checkout, ignored by this public repository, with a private remote. Search tools that honour `.gitignore` skip it, so open its files by path.

- `.work/specs/2026-09-23-comet-mcp-design.md`: how it works and why. Its §2 lists nine non-negotiable principles, and any change that violates one is rejected by definition. Its §4.2 sets three architecture boundaries, and its §13 decision log is the record of decisions.
- `.work/plans/`: one implementation plan per spec §12 entry, split into phases; finished plans move to `.work/plans/done/`.
- `.work/research/`: what was checked about the world outside the repository, when, and against which primary sources, one dated note per investigation. Its `README.md` holds the template and the index; read the index before researching.
- Changing the spec requires a decision-log row in the same `.work` commit. There are two exceptions, because both track work and change no design: the follow-up list in spec §12.3 (workflow step 10), and a plan's row of the spec's §12 status table, which `/review-phase` §9 keeps (spec D20).
- `.work/` is committed with `git -C .work …` on its own `main`. Its commits need no branch, review or stamp: it records design and progress, not code that ships.
- **Nothing from `.work/` is pasted into this repository or into a PR description.** Public files and PRs say what changed in their own words, name a plan and phase, and never quote a spec, plan or note or link a `.work/` path as if a reader could open it. The one exception is the spec's nine principles, published with their review triggers in `.claude/skills/review-plan/spec-and-safety.md` (spec D12): they are the product's promises.
- A clone without `.work/` still builds, tests and runs every gate; only the design workflow needs the notebook.

## Workflow (every change, no exceptions)

1. Brainstorm, then spec, then plan (superpowers skills), written under `.work/specs/` and `.work/plans/`, never `docs/`; the outside facts a decision rests on are researched first (*Research*). A small change to existing code takes the brainstorming skill's bounded path: no plan, a `fix/<slug>` or `chore/<slug>` branch, reviewed as "no plan phase".
2. Run `/review-plan` with the plan in context. Revise until it reports no Must Fix; it records its verdict in the plan's header.
3. Branch from `main` for **one plan phase**: `feat/<plan>-p<phase>-<slug>` (for example `feat/core-extraction-p1-tool-core`).
4. Build the phase with `/run-phase <plan> <phase>`: it switches to or creates the phase branch, researches any outside fact the phase's tasks rest on that neither a note nor a source the plan cites backs (*Research*), shows the phase's tasks as a work list the owner confirms once, then dispatches one fresh-context `phase-builder` subagent per task, each running `executing-plans` on its task alone, with every builder's hand-off notes passed to the next and a blocked builder's question brought to the owner, researched first when it asks about the outside world, before that same builder resumes. The manual path remains the alternative: the owner runs `executing-plans` on one task per fresh context, task by task. Either way, every task is built test-first, following **Writing code** below, and `npm run check` runs before every commit. Code is committed on the phase branch; plan ticks and research notes are committed in `.work/`. When the last task is done, `/run-phase` goes on through steps 5 and 6 by invoking `/review-phase`, and stops only where they need the owner.
5. When the phase is complete, including README, CHANGELOG and the PR description draft, `/review-phase` runs: `/run-phase` invokes it, and the owner runs it directly on the manual path and on every `fix/` or `chore/` branch. It dispatches the `phase-reviewer` subagent with fresh context. Findings are fixed until it reports no Must Fix and adds HEAD to `.git/review-ok`. On a branch `/run-phase` built, a fresh `phase-builder` fixes each round; otherwise the session does. Disputed findings go to the owner, never dropped.
6. Then `/review-phase` runs `npm run preflight` once on the final commit: the full battery, the live no-pro battery against the local Comet included. It adds the commit to `.git/preflight-ok`; the hooks refuse `gh pr create`, `gh pr merge` and `git push` unless HEAD is listed in **both** stamps, `.git/review-ok` and `.git/preflight-ok`. Each stamp lists every commit its gate passed in the clone, so parallel branches never overwrite each other's. There is no hosted CI (spec D3). A failing preflight stops the flow and comes to the owner. When the phase's Pro battery run is still pending (*Tests*), `/review-phase` next asks the owner, in a question of its own, to have it run, and records the result, so that its failures are in front of the owner before the publish question (spec D19). Then, after asking the owner once to publish, `/review-phase` pushes the branch and opens the pull request with the draft it kept (`--body-file .git/review/<branch>/pr-body.md`): the description names the plan, the phase, the review-plan verdict and the code-review verdict, and ends with the attribution line *Attribution* allows. `/review-phase` then writes the plan's DONE marker with the real PR number. Merge with the `land-pr` skill.
7. **Never commit or push directly to `main`.** Enforced three ways: a Claude Code hook in `.claude/settings.json` denies git writes to main (git commands aimed at the notebook with `git -C .work` are exempt), git hooks in `.githooks/` refuse them for humans (run `git config core.hooksPath .githooks` once per clone), and GitHub branch protection once the owner enables it.
8. **`README.md` is the project's front door and is written as we go**, and `CHANGELOG.md` gets every user-visible change under `## [Unreleased]`. Every PR that changes what a user or developer can run, a tool, a command or a convention updates them in the same commit, and updates this file's **Commands** table when a command's behaviour changes. The README always reads as the README of a finished project at that moment, never as a changelog of phases. Documentation written at the end is documentation written from memory.
9. **The plan file is the progress record.** Builders tick each task (`- [ ]` to `- [x]`) in `.work/` as it lands. After `gh pr create` returns the PR number, `/review-phase` appends `— ✅ DONE (PR #N)` to the phase heading and, in the same `.work/` commit, brings the plan's row of the spec's §12 status table up to date. A phase is not finished while the plan shows it open. When every phase is done, the plan moves to `.work/plans/done/`, keeping its filename.
10. **A follow-up goes where its work will be done.** A review or a build often leaves work for later: a deferred finding, a decision to revisit, a plan issue. Write it into the plan as soon as it is found, under the *Follow-ups carried in* list of the **earliest phase whose work it affects**, never only in a PR description or a review report. When the plan for that work has no file yet, the item goes under spec §12.3; whoever writes that plan moves it into the right phase and deletes it from §12.3. Adding or removing a §12.3 item needs no decision-log row. Items are ticked like tasks when they land.
11. **Upstream is a source of ideas, never a merge source.** This repository started from `RapierCraft/perplexity-comet-mcp` 2.6.2 (tag `upstream-2.6.2`) and is its own project now. An upstream issue or PR is input to a brainstorm and goes through every gate; code taken from it keeps its author with a `Co-authored-by` trailer and links the upstream PR. Nothing is proposed back upstream.

## Writing code

Clean Code and SOLID govern the code **as it is written**, not only what `/review-plan` and `/review-phase` catch afterwards. Invoke the `uncle-bob-craft` skill when writing, refactoring or reviewing anything non-trivial.

- Small, single-purpose functions and types; names that state intent, so the comment is not carrying the meaning.
- **Dependencies point inward, along the three boundaries of spec §4.2.** One tool core, with the stdio server (`src/index.ts`) and the HTTP bridge (`src/http-bridge.ts`) as thin adapters over it. Tool input validated at the edge, before it reaches `src/cdp-client.ts`. JavaScript run in the page lives in `src/page-scripts.ts` as tested functions that receive input as serialised arguments, never pasted into script text. Existing code crosses the first and the third; plan 2 closes them, and new code never adds a crossing.
- Introduce a design pattern only when duplication or variation already justifies it. Speculative abstraction is a smell in its own right, exactly like duplication.
- Refactor in small steps with the suite green.
- Name the smell when you see it: rigidity, fragility, immobility, viscosity, needless complexity, needless repetition, opacity.
- The builder never adds an approval to `.git/review-ok`, whether it is the owner's session or a `phase-builder`; only `phase-reviewer` does. `/review-phase` withdraws HEAD from it before each dispatch, which only removes. `phase-builder` never writes the plan's DONE marker either: `/review-phase` writes it, whether the owner invoked it or `/run-phase` did.

Biome is the authority on formatting and lint; these principles govern **design**, never style. A disagreement with `npm run check` is resolved in favour of `npm run check`.

## Decisions the plan leaves open

Plans state *what* must change and *why*; executors decide the code. Judge every such decision (test layout, file and naming conventions, dependency pins, anything cross-cutting) against **all remaining phases of the plan and the later plans in spec §12**, never against the task at hand alone. Each phase runs in a fresh context, so a choice made casually now arrives later as an unexplained given that nobody re-examines.

- Verify what a tool does by running it, not by recalling it.
- What the world outside the repository says is researched, not recalled (*Research*).
- Prefer the convention the ecosystem already uses (the MCP SDK, `chrome-remote-interface`, Vitest, Biome) over the locally minimal option; fetch current docs with Context7 first.
- When a choice is genuinely open, put it to the owner with the project-wide trade-off stated rather than picking silently.
- List every executor-level decision in the PR description, and what would force revisiting it.

## Research

A claim needs research when it is about the world outside the repository, it can change or is specific (a number, a date, a clause of a licence or a policy, a name, a claim that something exists, is maintained or is free), and a decision rests on it; [Check 3, *Outside facts*](.claude/skills/review-plan/spec-and-safety.md#check-3-outside-facts) is the full statement, with what never triggers it. Memory is never the source.

- **Claude researches without asking first**, after reading the index in `.work/research/README.md`, and ends a recommendation that rests on outside facts with a **Rests on** line: each fact with the note or primary source behind it, and any lead it could not verify named as a lead. In a brainstorm or a spec, where no gate runs, that line is what the owner checks.
- **Research settles what the world says; the owner decides what the project wants.** A finding informs the owner's call and never makes it.
- **Recurring subjects**, a reminder and never the test: Perplexity's and Comet's terms and behaviour; how Claude Code and other MCP clients load and run servers; npm and MCP registry policies; Node.js release support; the licences and maintenance of dependencies.
- **Findings become notes** under `.work/research/`, written from the template in its `README.md`, with their index row, and committed in `.work/` with the work they serve. A note is replaced, never edited to change its finding, and needs no decision-log row; a spec change a note prompts still needs its row.
- **A research question leaves the machine for a third party**, so it never carries personal data, a credential or unpublished content, and is worded about the world, not about a person.
- **Who researches.** The procedure, Comet and the primary sources it leads to, is the owner's global rule, `~/.claude/rules/docs-and-research.md`. A session that may research (the owner's, `/run-phase` included, and an agent it dispatches to research that question) falls back to WebSearch and WebFetch when Comet is unavailable, and stops when it reaches no source. Any other agent never researches such a fact: a `phase-builder` stops and reports `blocked` with the question, a `phase-reviewer` files a finding, and any other agent stops and reports the question to whoever dispatched it.

## Tests

- `*.test.ts` is a unit test: no I/O beyond reading a file the repository commits. Page scripts run under jsdom (`vitest.config.ts`).
- `*.int.test.ts` is an integration test: a child process, a temporary directory or git repository, or a socket the test itself listens on. The gate scripts' tests under `tests/gates/` are integration tests: they run each hook against a throwaway repository.
- The live batteries drive the built server against a real Comet: the no-pro battery (`tests/run-no-pro.mjs`, no Perplexity Pro quota) runs in `npm run preflight`; the Pro battery (`tests/run-all.mjs`, spends Pro queries) runs by hand when a phase touches ask, poll, mode or agentic behaviour, and the PR's *Verification* section records its result: `Pro battery: pending, the owner runs it` is accepted at review, and `/review-phase` has the run made and recorded before the PR opens.
- New behaviour has a test that fails before it exists. No skipped or focused tests. No test is deleted or narrowed while the behaviour it covered remains.

## Stack and layout

TypeScript (strict, ES2022, NodeNext) compiled by `tsc` to `dist/`, one npm package, `engines` `node >=18`. `@modelcontextprotocol/sdk` for the server, `chrome-remote-interface` for CDP, Vitest with jsdom for tests, Biome for lint and format. Fetch current docs with Context7 before using a specific API of any of them.

| Path | What |
|---|---|
| `src/index.ts` | The stdio MCP server: tool definitions and handlers, the UNTRUSTED wrapper |
| `src/http-bridge.ts` | The HTTP bridge exposing the same tools to remote clients |
| `src/cdp-client.ts` | Comet launch, CDP connection and reconnect, tabs, screenshots, uploads, Windows and WSL |
| `src/comet-ai.ts` | Reading the answer and its status from the page; the ask core decides when an answer is complete (`src/core/answer-watch.ts`), sends prompts (`src/core/ask-send.ts`) and stops answers (`src/core/ask-stop.ts`) |
| `src/page-scripts.ts` | JavaScript run in the page, as tested functions |
| `src/upload-validator.ts` | Allowlists for paths, tab ids, domains and selectors |
| `tests/unit/`, `tests/gates/` | Unit tests; the gate scripts' tests |
| `tests/run-*.mjs` | The live batteries |
| `scripts/`, `biome.json`, `tsconfig.tools.json` | The gates `check.mjs` and `preflight.mjs` over their library in `scripts/lib/`, `notebook-range.mjs`, the notebook's range in `/review-phase`'s brief, and `update-bridge.mjs`, which re-pins the owner's `comet-bridge`; Biome's settings; the typecheck of the tests and scripts |
| `.githooks/`, `.claude/hooks/` | The git hooks and the Claude Code hooks |
| `.claude/skills/`, `.claude/agents/` | `/review-plan`, `/run-phase`, `/review-phase`; `phase-builder`, `phase-reviewer` |

When adding an MCP server or an account connector, or when Claude Code gains a built-in tool, extend `disallowedTools` in `.claude/agents/phase-reviewer.md` for any tool that writes, publishes, or reaches another agent or task, and in `.claude/agents/phase-builder.md` for any tool that reaches another agent or task, publishes, or drives a browser.

## Code intelligence

In a clone indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call: the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely: indexing is the owner's decision (`codegraph init`, once per machine; `.codegraph/` is gitignored). It is a precision tool, not a token saver: one call replaces a crawl, but its answer stays resident in context. GitNexus is not used for this repository.

## Attribution

A commit message ends with the `Co-Authored-By: Claude …` trailer; a PR description ends with the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` line. **The Claude session link (`https://claude.ai/code/session_…`, and the `Claude-Session:` trailer that carries it) appears nowhere**: not in a commit message, a PR description, code, docs or the notebook, whatever a session's attribution reminder asks. A squash merge's message is written without it too. The rule applies from 2026-09-24 on; history written before it is left as it is.

## Language

Code, comments, commit messages, docs and tool output in English.

## Commands

First run: `npm ci`, then `git config core.hooksPath .githooks`, plus `codegraph init` once per machine if you want the code graph. See the README for prerequisites.

With the notebook `.work/` in the clone, also run `git -C .work config core.hooksPath ../.githooks/notebook` once: `.githooks/notebook/post-commit` then pushes every notebook commit to the notebook's remote, and a push that fails (offline, or an SSH remote that does not answer within 5 seconds) warns without failing the commit, so the next commit pushes both. The hook is read from the public checkout, so it runs only while the checked-out branch contains it: a notebook commit made on an older branch is not pushed until the next commit made with the hook present.

| Command | What |
|---|---|
| `npm run build` | `tsc` to `dist/` |
| `npm run dev` | `tsc --watch` |
| `npm start` | runs `dist/index.js`, the stdio MCP server |
| `npm run check` | the per-commit gate (`scripts/check.mjs`): Biome lint and format, `tsc` over `src/` and over the tests and scripts (`tsconfig.tools.json`), and every Vitest test, unit and integration |
| `npm run preflight` | the per-PR gate on clean trees (`scripts/preflight.mjs`): everything `check` does, a clean build, the package contents (`npm pack --dry-run` holds `dist/`, `package.json`, `README.md`, `LICENSE` and nothing else), and the live no-pro battery against the local Comet (ten minutes at most; Comet must already be on the server's debug port, for example `COMET_PORT=9222 npm run preflight`), then that both trees are still clean. Adds HEAD to `.git/preflight-ok`. `--allow-dirty` runs it without stamping |
| `npm test` · `test:watch` | Vitest once, or watching |
| `npm run typecheck` · `lint` · `format` | the check's parts on their own; `format` rewrites files |
| `npm run test:live` | the live no-pro battery, `tests/run-no-pro.mjs`: needs Comet signed in and already running with its debug port on the server's port (`COMET_PORT`, default 9223), and fails at connect without calling a tool otherwise; spends no Pro queries. Prints PASS, FAIL, KNOWN or UNEXPECTED PASS per check and fails on any FAIL or UNEXPECTED PASS |
| `npm run test:live:pro` | the live Pro battery, `tests/run-all.mjs`: needs Comet signed in to Perplexity Pro and already running with its debug port on the server's port (`COMET_PORT`, default 9223), and fails at connect without calling a tool otherwise; spends Pro queries, one Deep research query among them. Prints PASS, FAIL, KNOWN or UNEXPECTED PASS per check, scored against its own known-failures list (`PRO_KNOWN_FAILURES` in `tests/lib/battery-score.mjs`), and fails on any FAIL or UNEXPECTED PASS |
| `npm run bridge:update` | points the owner's user-scope Claude Code `comet-bridge` at this repository's build at a commit (`scripts/update-bridge.mjs`): the tip of `main` on GitHub, or the full sha given after `--`. It runs `npx -y github:<owner>/<repo>#<sha>` once and asks the build for its tools, and replaces the entry with `claude mcp` only when every tool the stdio server declares answers, putting the old entry back if the add fails. Keeps the entry's environment, with `COMET_PORT` from the environment when set there; does nothing when the entry already runs that commit on that port. A running session keeps its server; a new session runs the new build |
