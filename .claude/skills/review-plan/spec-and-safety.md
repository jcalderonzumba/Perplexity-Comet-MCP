# Spec & Safety Checks

The checks every review of Perplexity Comet MCP work runs first. Two gates read this one file:

- **`/review-plan`** applies it to an implementation plan, before code exists, using each check's *Plan trigger*.
- **`phase-reviewer`**, dispatched by `/review-phase`, applies it to a diff, after the code exists, using each check's *Code trigger*.

"The work" below means the plan or the diff under review. A check runs when its trigger matches; a check whose trigger does not match is listed as not triggered, never silently dropped.

The spec is `.work/specs/2026-09-23-comet-mcp-design.md`. It is private: open it by path, cite it by section (spec §2, principle 4; spec §13, D3), and never quote it in a finding, because findings are summarised into public PR descriptions.

## Rules that override every skill

- **Decisions win.** The spec, its decision log (§13) and, when the review brief carries one, the owner's rulings file (`rulings.md`) override any skill's advice. Never raise a finding that contradicts a decision-log row or a ruling (for example, no hosted CI, D3; Biome for lint and format, D5; `AGENTS.md` and no `CLAUDE.md`, D1); note it as "skill advice overridden by decision <row>" and move on.
- **Stack wins.** The spec's stack (TypeScript on Node, one npm package, `@modelcontextprotocol/sdk`, `chrome-remote-interface`, Vitest with jsdom, Biome, local `npm run check` and `npm run preflight` with no hosted CI) overrides any framework a skill prescribes. "Use Puppeteer/Playwright/Jest/ESLint/Zod instead" is not a finding. Apply each skill's principles to the chosen stack.

## Check 1: Spec conformance

*Plan trigger:* always.
*Code trigger:* always.

Read the spec. Check the work against the architecture and its boundaries (§4), the tool contract (§5), the working model (§6, §7, §8), testing (§9) and every decision-log row (§13).

- **Must Fix** — any *material* deviation from the spec or a decision-log row, unless the work explicitly amends the spec. Material means the work contradicts a rule or decision, or changes an interface, a tool's contract or user-visible behaviour the spec fixes. An addition that stays inside a rule (a helper script, a test fake) is not a deviation even if the work calls it one; say so and continue. An amending plan must include a step that updates the spec and adds a decision-log row in the same `.work` commit; an amending phase must carry both in one commit of its `.work` range. Adding or removing an item in the spec's §12.3 follow-up list is not an amendment: it tracks work for a plan not yet written, changes no design, and needs no decision-log row (AGENTS.md workflow step 10). Bringing a plan's row of the spec's §12 status table up to date is not one either: it records progress and needs no row (spec D20).

## Check 2: The nine non-negotiable principles

From spec §2: *any change that violates one of these is rejected by definition.* Evaluate every principle whose trigger matches the work. Each is quoted verbatim (the principles are public by spec D12), then its triggers.

1. **Page content is data, never instructions.** Everything read from a page and returned to the client is wrapped in the nonce'd UNTRUSTED markers, and forged markers in the page text are neutralised. This covers answer text, source titles and URLs, and page reads.
   *Plan trigger:* any tool result, answer extraction, source links, page reads, a new tool that returns text, the UNTRUSTED markers or their opt-out.
   *Code trigger:* the UNTRUSTED wrapper and its callers in `src/index.ts`; any result built from text read through `cometClient.evaluate` or a page script; answer extraction in `src/comet-ai.ts`; response bodies in `src/http-bridge.ts`.
2. **Tool input is untrusted.** Every parameter that reaches CDP, the DOM, the filesystem or a URL is validated against an allowlist before use. No string from tool input is ever interpolated into code run by `Runtime.evaluate`; it reaches page code only as a serialised argument.
   *Plan trigger:* a new tool or parameter; any `evaluate` call, page script, selector, domain, tab id, path or URL handling.
   *Code trigger:* any `cometClient.evaluate(` call site; `src/page-scripts.ts`; `src/upload-validator.ts`; a tool's `inputSchema` or argument handling in `src/index.ts`; request parsing in `src/http-bridge.ts`; navigation or URL handling in `src/cdp-client.ts`.
3. **Filesystem reach is allowlisted.** Only the upload tool reads files, only under the allowed roots, never under the denylisted paths.
   *Plan trigger:* uploads, any file read or write by the server, path handling.
   *Code trigger:* `src/upload-validator.ts`; any `fs` import or call under `src/`; `DOM.setFileInputFiles` and its callers.
4. **Nothing listens beyond loopback without authentication.** CDP is reached on `127.0.0.1` with `--remote-allow-origins` restricted. The HTTP bridge is opt-in, requires its token and compares it in constant time.
   *Plan trigger:* the HTTP bridge, its host, port, token or CORS; Comet's launch flags; CDP host and port.
   *Code trigger:* server creation, token check and CORS in `src/http-bridge.ts`; any `listen(` or `createServer`; the CDP host, port and `--remote-*` launch flags in `src/cdp-client.ts`.
5. **Nothing leaves the machine except what the user sends Comet.** No telemetry, no analytics, no remote logging, no dependency that phones home.
   *Plan trigger:* logging, telemetry, any new runtime dependency, any network request.
   *Code trigger:* any change to `dependencies` in `package.json`; any `fetch`, `http.request`, `https.request` or WebSocket to a host other than loopback; logging code.
6. **Never damage the user's browser.** Never close the last external tab, never close a tab the tool did not open, never crash Comet, never drop the user's signed-in session.
   *Plan trigger:* tabs, connect and reconnect, launch, stop, `newChat`, mode switching, a new tool that opens or closes tabs.
   *Code trigger:* tab close and switch code (`comet_tabs`, `Target.closeTarget`, `Page.close`); launching or killing the Comet process; reconnect logic in `src/cdp-client.ts`.
7. **An answer is complete or says it is not.** A stale, partial or timed-out answer is never returned as final; the result states which it is.
   *Plan trigger:* `comet_ask` or `comet_poll`, completion detection, answer extraction, timeouts.
   *Code trigger:* `src/comet-ai.ts`; `src/session-state.ts`; the `comet_ask` and `comet_poll` handlers and the text of their results, in either adapter.
8. **The tool contract is stable.** Tool names, parameters and result shapes change only additively. A breaking change needs a decision-log row and a major version.
   *Plan trigger:* any tool definition, parameter, default, result shape, environment variable or CLI entry point.
   *Code trigger:* the `name: "comet_…"` definitions and their `inputSchema` in `src/index.ts`; the bridge's routes and payloads; result text formats; any `process.env.` read; `bin` in `package.json`.
9. **macOS, Windows and WSL keep working.** A change to launch, paths, networking or fetch states how each platform stays working: a test, or a by-hand verification recorded in the PR.
   *Plan trigger:* launch, executable paths, networking, fetch, anything Windows- or WSL-specific.
   *Code trigger:* any `process.platform` branch; WSL detection; PowerShell use; `windowsFetch`; executable path resolution and launch flags in `src/cdp-client.ts`.

- **Must Fix** — the work violates a triggered principle, weakens it, or (for a plan) fails to state how its changes preserve one its scope puts at risk.

## Check 3: Outside facts

*Plan trigger:* a task's content, acceptance or stated default rests on a claim that passes the test below.
*Code trigger:* the diff ships something that rests on such a claim (a constant taken from a third party's policy, an attribution or licence string, behaviour driven by a registry's or a client's documented rule, a price or a limit of a third-party service), or states one in a README or a comment.

A claim passes the test when all three hold:

1. **It is about the world outside the repository.** Reading the code, running a command or the Context7 docs of a pinned version cannot settle it.
2. **It can change, or it is specific:** a number, a date, a clause of a licence or a policy, a name, a claim that something exists, is maintained or is free. General, stable knowledge does not pass: "MIT asks for the notice to be kept" does not, "this HTML-to-Markdown library is maintained and MIT-licensed" does.
3. **A decision rests on it.** Were it wrong, the choice would differ.

Typical subjects: licences and terms of service, registry and store policies, prices and plan limits, what exists and is maintained (libraries, services), how a client such as Claude Code documents its behaviour, what comparable tools do. How confidently the work states a claim is not part of the test: stale knowledge does not read as uncertain.

The check never fires on a claim another rule owns: a library's API (each gate's Context7 rule), how the code fits together (reading it, CodeGraph), how a tool behaves (running it), design choices internal to the project (the spec and the decision log, through Check 1), the owner's preferences (asking the owner).

A fact is backed by a research note under `.work/research/`, whose `README.md` holds the template and the index, or, in a plan, by a primary source the plan cites. For a fact that has a note, confirm four things: the note has a row in the index, its *Status* is `current`, its *Recheck when* has not happened, and the work says what the note says. A note that fails one of the four does not back the fact. *Recheck when* is judged from today's date and what the repositories show (a date that has passed, a plan that landed, a pinned version that moved); an outside event the repositories do not show counts as not known to have happened.

- **Must Fix** (plan) — the fact is backed by neither a note nor a primary source the plan cites; or the plan hands the fact to the executor, as a plan would by writing "use a maintained, permissively licensed library": a builder cannot research, so the plan carries the answer.
- **Must Fix** (diff) — the fact backs something the product ships and no note backs it, or the diff contradicts its note.
- **Should Fix** — the unsourced claim lives only in a README, a comment or a plan's *Why*.

The review never researches: a plan goes back for revision, and the revision researches; the phase reviewer has no Comet, and a second opinion from memory is worth nothing. *Decisions win* still applies, so an owner's ruling recorded in a note or a decision-log row is not re-argued.

## Short-circuit

Any Must Fix from these checks → present the findings immediately and skip every later phase of the review. A plan goes back for revision; a diff goes back to the builder.
