# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- **Local gates** - Git hooks under `.githooks/` refuse commits and pushes to `main`, and refuse to push a branch until its last commit passed the phase review and preflight
- **Claude Code hooks** - `.claude/settings.json` runs `protect-main.sh` on git commands and `pr-gate.sh` on `gh pr create` and `gh pr merge`, refusing writes to `main` and pull requests whose last commit lacks either stamp
- **`AGENTS.md`** - the project's instructions for people and coding agents: where the design lives, the workflow and its gates, how code is written and tested
- **`/review-plan`** - a Claude Code skill that reviews an implementation plan against the design's principles and boundaries, the code graph and a set of skills picked by what the plan touches, before anything is built
- **`/run-phase` and `phase-builder`** - a Claude Code skill that builds one plan phase with one fresh-context builder subagent per task, test-first, carrying each builder's notes to the next, then goes on through `/review-phase` to the pull request
- **`/review-phase` and `phase-reviewer`** - a Claude Code skill that reviews a finished phase with a fresh-context, read-only reviewer, which alone approves the commit for the push and PR gates. It has each round's findings fixed by a fresh builder on a branch `/run-phase` built, runs the preflight, and opens the pull request after asking the owner once
- **`npm run check` and `npm run preflight`** - the local per-commit and per-PR gates; preflight runs the live no-pro battery against the local Comet and stamps the commit
- **Biome** - lint and format for the whole codebase

### Changed

- `npm test` runs the Vitest suite; the live batteries are `npm run test:live` (no Pro queries) and `npm run test:live:pro` (spends Pro queries)
- **The live no-pro battery scores every check** - each check has a condition that can fail and prints `PASS`, `FAIL`, `KNOWN` or `UNEXPECTED PASS`; a known-failures list gives the reason and the owning plan for each check that fails for a known cause (today the `labs` and `learn` mode switches), and the battery fails on any failure or unexpected pass. It needs Comet already running with its debug port on the server's port (`COMET_PORT`, 9223 by default), starts the server on that same port, and fails at connect without calling a tool when nothing answers there
- **`comet_mode` works with Perplexity's current mode menu** - `research` selects Deep research again. A switch opens the mode menu with real pointer clicks, selects the item by its exact label, and reads the menu back: it reports `Switched to <mode> mode` only when the page shows that mode, returns an error naming what the page showed otherwise, and always closes the menu. `labs` fails saying Perplexity's input bar no longer offers it, and `learn` fails as not supported yet. Without a mode, the current mode is read from the page's mode button, and reported as `unknown` with what the button reads, instead of defaulting to `search`; a page that fails while it is read gives an error reply with the page's error message quoted, like any other page text
- **The HTTP bridge answers `comet_mode` as the stdio server does** - the same switch, the same replies, and page text in them wrapped in the UNTRUSTED markers
- **`npm run preflight` fails closed on a `git` read it cannot make** - a failed `git status` (of the working tree, or of a `.work/` directory that is not a git repository of its own) or `git rev-parse HEAD` stops it with the failing command, and it records no approval, instead of reading the failure as a clean tree
- Commit messages, pull request descriptions, code and docs no longer carry the Claude session link. `AGENTS.md` gains an *Attribution* section, and the `/review-phase` template, the `/run-phase` brief and both subagents follow it.

### Fixed

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
