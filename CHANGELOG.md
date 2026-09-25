# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- **Local gates** - Git hooks under `.githooks/` refuse commits and pushes to `main`, and refuse to push a branch until its last commit passed the phase review and preflight
- **A post-commit push hook for a nested notebook repository** - `.githooks/notebook/post-commit` pushes each commit of the repository that opts in (`git -C .work config core.hooksPath ../.githooks/notebook`) to the branch it tracks: a plain push, never a force push. A push that fails prints a warning and keeps the commit, and the next commit pushes both; the warning says when the remote has commits the clone must pull first. An SSH remote that does not answer is given up after 5 seconds, and the push never waits on a password or passphrase prompt. The public repository's own hooks never run it, and `/run-phase` checks the setting before it builds
- **Claude Code hooks** - `.claude/settings.json` runs `protect-main.sh` on git commands and `pr-gate.sh` on `gh pr create` and `gh pr merge`, refusing writes to `main` and pull requests whose last commit lacks either stamp
- **`AGENTS.md`** - the project's instructions for people and coding agents: where the design lives, the workflow and its gates, how code is written and tested
- **`/review-plan`** - a Claude Code skill that reviews an implementation plan against the design's principles and boundaries, the code graph and a set of skills picked by what the plan touches, before anything is built
- **`/run-phase` and `phase-builder`** - a Claude Code skill that builds one plan phase with one fresh-context builder subagent per task, test-first, carrying each builder's notes to the next, then goes on through `/review-phase` to the pull request
- **`/review-phase` and `phase-reviewer`** - a Claude Code skill that reviews a finished phase with a fresh-context, read-only reviewer, which alone approves the commit for the push and PR gates. It has each round's findings fixed by a fresh builder on a branch `/run-phase` built, runs the preflight, and opens the pull request after asking the owner once
- **`npm run check` and `npm run preflight`** - the local per-commit and per-PR gates; preflight runs the live no-pro battery against the local Comet and stamps the commit
- **Biome** - lint and format for the whole codebase

### Changed

- `npm test` runs the Vitest suite; the live batteries are `npm run test:live` (no Pro queries) and `npm run test:live:pro` (spends Pro queries)
- **The live no-pro battery scores every check** - each check has a condition that can fail and prints `PASS`, `FAIL`, `KNOWN` or `UNEXPECTED PASS`; a known-failures list gives the reason and the owning plan for each check that fails for a known cause (today the `learn` mode switch alone), and the battery fails on any failure or unexpected pass. The mode reads pass only on a mode read from the page, never on an error or `unknown`, and the `labs` check passes on the error saying Perplexity no longer offers Labs. It needs Comet already running with its debug port on the server's port (`COMET_PORT`, 9223 by default), starts the server on that same port, and fails at connect without calling a tool when nothing answers there
- **`comet_mode` works with Perplexity's current mode menu** - `research` selects Deep research again. A switch opens the mode menu with real pointer clicks, selects the item by its exact label, and reads the menu back: it reports `Switched to <mode> mode` only when the page shows that mode, returns an error naming what the page showed otherwise, and always closes the menu. `labs` fails saying Perplexity's input bar no longer offers it, and `learn` fails as not supported yet. Without a mode, the current mode is read from the page's mode button, and reported as `unknown` with what the button reads, instead of defaulting to `search`; a page that fails while it is read gives an error reply with the page's error message quoted, like any other page text
- **The mode survives a new chat** - `comet_ask` puts the page back in the mode `comet_mode` last set, after its own navigation (a new chat, a reconnect) and before it types the prompt, since Perplexity resets the mode to Search on every navigation; so `comet_mode research` then `comet_ask` with `newChat: true` asks in Deep research. When the mode cannot be put back, the ask still runs and its result starts with a `Mode not applied:` line saying why, page text in it wrapped. Without a mode set, or with the page already in it, nothing is clicked and the result is unchanged. The stdio server and the HTTP bridge behave alike
- **The live Pro battery starts the server on the port it checks** - like the no-pro battery, it passes `COMET_PORT` (9223 by default) to the server it starts, asks that port before connecting, and calls no tool when nothing answers there, so it never launches Comet or restarts one listening on another port; when connect fails, nothing else runs. A new `[7.4-research-workflow]` check runs `comet_mode research`, then `comet_ask` with `newChat: true`, then `comet_mode`, and passes when the ask's result has no `Mode not applied:` line and the page still reads `research`
- **The HTTP bridge answers `comet_mode` as the stdio server does** - the same switch, the same replies, and page text in them wrapped in the UNTRUSTED markers
- **`npm run preflight` fails closed on a `git` read it cannot make** - a failed `git status` (of the working tree, or of a `.work/` directory that is not a git repository of its own) or `git rev-parse HEAD` stops it with the failing command, and it records no approval, instead of reading the failure as a clean tree
- **`/review-phase` keeps the plan status and waits for the Pro battery** - when it marks a phase done after the pull request opens, the same notebook commit brings the plan's row of the design's plan status table up to date, and moves the row to done with the plan's last phase. Like the design's follow-up list, that row changes with no decision-log entry, and `AGENTS.md` and `phase-reviewer` now name both exceptions. A phase that touches asking, polling, modes or agentic browsing may reach review with its Pro battery run still pending; `/review-phase` asks the owner to have it run, and records the result, before the pull request opens, and `phase-reviewer` no longer asks for the run at review time
- Commit messages, pull request descriptions, code and docs no longer carry the Claude session link. `AGENTS.md` gains an *Attribution* section, and the `/review-phase` template, the `/run-phase` brief and both subagents follow it.

### Fixed

- **`/review-phase` hands the reviewer every notebook commit of the phase** - the notebook range in its review brief now comes from `scripts/notebook-range.mjs`: it starts at the work list's *Start* when `/run-phase` built the branch, and otherwise at the last notebook commit made before the branch was created, read from the branch's reflog. A notebook commit made in the same second as the branch's first commit is no longer taken for the base and dropped from the range. The script prints nothing in a clone without `.work/`, and fails naming the reason when `.work/` is not a readable repository
- **The HTTP bridge wraps `comet_ask`'s answer** - the answer comes back in the UNTRUSTED markers with a fresh nonce, as it always did over stdio, instead of as bare page text; `COMET_DISABLE_UNTRUSTED_MARKERS=1` opts out as before
- **Mode clicks land only on Perplexity** - before each pointer click of a mode switch, the server asks the browser for the tab's origin and clicks only when it is exactly `https://www.perplexity.ai`; on any other site, including one whose address merely contains `perplexity.ai`, the switch fails and nothing is clicked. `comet_mode` likewise decides whether to open Perplexity first from the tab's origin read at that moment, rather than from the last address the server navigated to
- **The live batteries wait for a call as long as they allow it** - each call's limit now reaches the MCP SDK, whose 60-second default had stopped the Pro battery's longer calls, the Deep research ask among them, with `MCP error -32001: Request timed out`; a call past its limit fails with `TIMEOUT after <limit>ms`, as before
- **A forged close marker in page text is neutralised** - text read from the page that imitates the `[END UNTRUSTED PAGE CONTENT nonce=…]` marker the server writes is now defused like a forged opening marker, before it is wrapped

### Removed

- GitHub Actions workflows: the gates run locally, and publishing returns with the publishing plan

## [2.6.2] - 2026-01-11

### Fixed

- **WSL Support Complete** - Fixed `windowsFetch` to use PowerShell on WSL (was incorrectly using native fetch which connects to WSL localhost instead of Windows)
- **Tab Cleanup Crash** - Removed aggressive tab cleanup in `comet_connect` that was closing tabs and crashing Comet browser
- **WSL Networking Detection** - Added automatic detection of WSL mirrored networking with helpful error message and setup instructions

### Added

- **WSL Mirrored Networking Guide** - Clear instructions in error messages for enabling WSL2 mirrored networking
- **WSL Troubleshooting Docs** - Added WSL-specific troubleshooting section to README

### Changed

- Simplified `comet_connect` to preserve all existing tabs instead of cleaning up blank tabs

## [2.6.1] - 2026-01-10

### Fixed

- WSL browser launching via PowerShell with `Set-Location` to avoid UNC path issues

## [2.6.0] - 2026-01-10

### Added

- **File Upload Support** - New `comet_upload` tool for uploading files to web forms
- Major stability improvements

## [2.4.0] - 2026-01-10

### Added

- **Tab Management System** - New `comet_tabs` tool for viewing, switching, and closing browser tabs
- **Tab Registry** - Internal tracking of all external browsing tabs with purpose and domain
- **Last Tab Protection** - Prevents closing the only external tab which would crash Comet
- **Internal Tab Filtering** - Automatically filters chrome://, devtools://, and Perplexity UI tabs
- **Windows/WSL Support** - Full compatibility with Windows and WSL environments
- **PowerShell Fetch Workarounds** - Bypasses Node.js fetch issues on Windows
- **Direct CDP WebSocket Connection** - More reliable connection on Windows
- **Smart Completion Detection** - Response stability tracking instead of fixed timeouts
- **Auto-Reconnect** - Exponential backoff recovery (300ms-2s) from connection drops
- **Health Check Caching** - 2-second cache for efficient connection validation
- **Pre-Operation Checks** - Validates connection before every operation
- **Agentic Prompt Transformation** - Automatically triggers browser actions for URLs and action verbs
- **DOM-Based Submit** - More reliable prompt submission using DOM events
- **Full Response Extraction** - Captures complete responses after "X steps completed" marker
- **Tab Change Handling** - Maintains Perplexity connection during agentic browsing
- **Idle Timeout Detection** - 6-second idle detection for completion

### Changed

- Increased max reconnect attempts to 10
- Reduced poll interval to 1.5 seconds for better responsiveness
- Improved error recovery with Perplexity tab switching

### Fixed

- Connection drops during long agentic tasks
- Response truncation on complex queries
- Submit not working (text in box but not sent)
- Browser crash when closing last tab
- Incorrect tab counting due to internal Chrome tabs

## [1.0.0] - Original Release

- Initial fork from [hanzili/comet-mcp](https://github.com/hanzili/comet-mcp)
- Basic 6 tools: connect, ask, poll, stop, screenshot, mode
- macOS support
