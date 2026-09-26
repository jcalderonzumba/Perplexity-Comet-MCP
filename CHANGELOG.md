# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- **Local gates** - Git hooks under `.githooks/` refuse commits and pushes to `main`, and refuse to push a branch until its last commit passed the phase review and preflight
- **A post-commit push hook for a nested notebook repository** - `.githooks/notebook/post-commit` pushes each commit of the repository that opts in (`git -C .work config core.hooksPath ../.githooks/notebook`) to the branch it tracks: a plain push, never a force push. A push that fails prints a warning and keeps the commit, and the next commit pushes both; the warning says when the remote has commits the clone must pull first. An SSH remote that does not answer is given up after 5 seconds, and the push never waits on a password or passphrase prompt: ssh runs in batch mode, and git neither asks on the terminal nor calls an askpass program (`GIT_ASKPASS`, `core.askPass` or `SSH_ASKPASS`), while a configured credential helper still supplies stored credentials. The public repository's own hooks never run it, and `/run-phase` checks the setting before it builds
- **Claude Code hooks** - `.claude/settings.json` runs `protect-main.sh` on git commands and `pr-gate.sh` on `gh pr create` and `gh pr merge`, refusing writes to `main` and pull requests whose last commit lacks either stamp. `protect-main.sh` exempts git commands aimed at the nested notebook (`git -C .work …`), and judges a command's text twice, as written and read as the shell reads it (double, single and `$'…'` quotes, backslash escapes, newlines inside quotes, a backslash-newline removed even inside a word, and a `#` that starts a word commenting out the rest of its line), refusing when either reading could still reach `main`: a global option's argument quoted or escaped, spaces and all, a line continued with a backslash, even inside a word, `main` quoted, escaped or beside a parenthesis in a push, and a notebook command after any `GIT_` variable the command names, such as `GIT_DIR`, `GIT_WORK_TREE` or `GIT_CONFIG_*`. It never runs the command, so some forms pass it and only the git hooks refuse them: a word made at run time (a variable's value, a command substitution), a brace expansion, a quote inside a heredoc's body, a git alias, and `git push --all` or `--mirror`
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
- **The live Pro battery scores its checks like the no-pro battery** - each check prints `PASS`, `FAIL`, `KNOWN` or `UNEXPECTED PASS` and the run ends with the same summary line, scored against a known-failures list of its own; the battery exits non-zero on any failure or unexpected pass. The two lists are kept apart, so an entry never excuses the check with the same id in the other battery. Its screenshot checks, `[5.1]` and `[5.2]`, use the no-pro battery's screenshot condition, and fail on an error result
- **Every live Pro check has a condition that can fail** - an ask's check passes only on a final answer naming what was asked, never on a login page, an error or a result still in progress, nor, for `[1.5]` and `[2.5]`, whose prompts name the word, on a reply holding the prompt read back, and each ask gets a `timeout` below the battery's limit on the call, so the server's own result is judged. `[2.2]` fails when a follow-up returns the previous turn's answer, `[3.4]` passes only on a GitHub `owner/name` with a star count and fails on a reply that carries an earlier browsing ask's answer, `[2.4]` passes only when a timed-out ask says its answer may be incomplete, and the poll, stop, tab, upload, empty-prompt and invalid-mode checks pass only on the reply each expects; the screenshot, tab-listing and mode checks are the no-pro battery's own, so `[7.2-learn]` now fails as it does there. `[3.2]` and `[3.3]`, which passed a `tabPolicy` parameter `comet_ask` never had, give way to `[3.2-agent-tab]` (the agent's tab is listed after an agentic ask) and `[3.3-tabs-kept]` (every tab open before the ask is still open after it), and a new `[2.6-whole-answer]` checks that a three-paragraph answer comes back whole, each paragraph's opening word starting a line. A test holds every call the battery makes to the tool's declared parameters. The known-failures list names the `comet_ask` reliability plan for `[1.5]`, `[2.1]`, `[2.2]`, `[2.3]`, `[2.4]`, `[2.5]`, `[2.6-whole-answer]` and `[4.3b]`, the Agentic browsing plan for `[3.1]`, `[3.2-agent-tab]`, `[3.3-tabs-kept]`, `[3.4]` and `[6.3]`, and the Learn mode plan for `[7.2-learn]`
- **The HTTP bridge answers `comet_mode` as the stdio server does** - the same switch, the same replies, and page text in them wrapped in the UNTRUSTED markers
- **`npm run preflight` fails closed on a `git` read it cannot make** - a failed `git status` (of the working tree, or of a `.work/` directory that is not a git repository of its own) or `git rev-parse HEAD` stops it with the failing command, and it records no approval, instead of reading the failure as a clean tree
- **`/review-phase` keeps the plan status and waits for the Pro battery** - when it marks a phase done after the pull request opens, the same notebook commit brings the plan's row of the design's plan status table up to date, and moves the row to done with the plan's last phase. Like the design's follow-up list, that row changes with no decision-log entry, and `AGENTS.md` and `phase-reviewer` now name both exceptions. A phase that touches asking, polling, modes or agentic browsing may reach review with its Pro battery run still pending; `/review-phase` asks the owner to have it run, and records the result, before the pull request opens, and `phase-reviewer` no longer asks for the run at review time
- Commit messages, pull request descriptions, code and docs no longer carry the Claude session link. `AGENTS.md` gains an *Attribution* section, and the `/review-phase` template, the `/run-phase` brief and both subagents follow it.
- **`comet_ask` refuses arguments it used to coerce** - a `timeout` that is not a positive number of milliseconds (text, a negative number) and a `newChat` that is not `true` or `false` are refused with an error naming the parameter, where the first used to end the wait at once and the string `"false"` started a new chat; a `prompt` or `context` that is not text is refused too. An absent or zero `timeout` still means the default, and a numeric string its number. Over stdio, a refused or failed ask is flagged `isError`, the empty prompt's refusal included, which used to come back unflagged
- **The HTTP bridge's `comet_ask` is the stdio server's** - one ask serves both, so the bridge gains the check that never returns the previous turn's answer for a new question, no longer returns an empty page read as the answer, and, when its connection to Comet is lost, starts Comet on the debug port `COMET_PORT` names, as the stdio server does, instead of always on 9223; Comet launches on macOS, Windows and WSL as before, only on that port. The error of a refused or failed ask now starts `Error:`, as over stdio. The bridge's `comet_poll` and `comet_stop` follow the task the ask started
- **`comet_poll` and `comet_stop` are one tool core for both adapters** - the stdio server and the HTTP bridge give the same poll and stop, over the task `comet_ask` started. A poll of a task whose ask ran out of time returns the answer only once `comet_ask`'s own rules find it complete, never the answer that was on the page before the prompt was sent, and until then reports `Status: WORKING`, says the answer may be incomplete, and gives the partial answer so far with the steps; it used to report only the steps, and to return whatever the page showed once it read completed. An answer a poll finds complete now starts with `Status: COMPLETED`, like an answer completed earlier. After `comet_stop`, a poll reports the page's status and no answer, where it used to return the page's text as the answer. Over the HTTP bridge, `comet_poll`'s `content` is now the stdio server's text: an idle poll says `Status: IDLE`, a task's partial answer is no longer cut at 500 characters, and the poll no longer repeats the prompt. When the page fails while `comet_ask` or `comet_poll` reads it, the error reply quotes the page's error message in the UNTRUSTED markers, like any other page text, and a poll's error starts `Status: UNKNOWN` and says the task is still active

### Fixed

- **`comet_ask` and `comet_poll` read the latest turn's answer, whole** - the answer is found where Perplexity places it, in the latest turn's answer block, and read block by block. A one-word answer such as `Paris` used to read as no answer at all, since an answer had to be longer than 15 characters, and now reads as a completed answer. In a thread with earlier turns, the answer used to be read from the whole page's text or from its last three answer-like blocks, which could run an earlier turn's list items into the new answer, or return only the closing list items of a long one; now nothing of an earlier turn comes back, and while the latest turn has no answer yet there is none. The answer is no longer cut at 8000 characters, and has no length limit. Paragraphs, headings, list items and table rows come back as blocks separated by a blank line, list items marked `- ` or numbered, a table's cells separated by ` | `, and a code block as its code without its caption. The inline citation chips are left out, where they used to break a sentence over several lines, and emoji in the answer are kept, where they used to be removed
- **An answer reads as in progress only while Perplexity's stop control shows** - `comet_ask` and `comet_poll` take the page for still answering from the button Perplexity's input bar shows while it answers, labelled `Stop response (Esc)`, and from no other button. Any button holding a square icon (Perplexity's pane toggle among them) and any button whose label contains "stop" or "cancel" anywhere on the page, the answer's read-aloud `Stop` and the input bar's `Stop dictation` included, used to count, so a finished answer could read as still working until the ask ran out of time
- **`comet_ask` and `comet_mode` never use Comet's sidecar or a page of yours** - one rule decides which tab is Perplexity's main page: a tab whose address, as the browser reports it, is on `https://www.perplexity.ai` outside the sidecar's `/sidecar` path. It used to be a check that the address contained `perplexity.ai` and not `sidecar`, so the ask typed into the sidecar (`https://www.perplexity.ai/sidecar`) when connected to it and then ran to its timeout, a page naming Perplexity in its path or query counted as Perplexity, and a thread whose address mentions a sidecar did not. When the connected tab is not Perplexity's main page, the ask moves to one already open; when none is, it opens Perplexity's home page in a new tab and asks there, where it used to navigate the connected tab, a page of yours included, to Perplexity. A new chat whose navigation fails reconnects to Perplexity's main page, or opens one, instead of sending another page to Perplexity. `comet_mode` goes to Perplexity's main page the same way before a switch, where it used to navigate the connected tab, and it no longer takes the sidecar for Perplexity. The waits for an answer and `comet_poll` read the tab's address through the browser rather than from page script
- **`/review-phase` hands the reviewer every notebook commit of the phase** - the notebook range in its review brief now comes from `scripts/notebook-range.mjs`: it starts at the work list's *Start* when `/run-phase` built the branch, and otherwise at the last notebook commit made before the branch was created, read from the branch's reflog. A notebook commit made in the same second as the branch's first commit is no longer taken for the base and dropped from the range. The script prints nothing in a clone without `.work/`, and fails naming the reason when `.work/` is not a readable repository
- **The HTTP bridge wraps `comet_poll`'s page text** - the answer, the partial answer and the steps come back in the UNTRUSTED markers with a fresh nonce, as over stdio, instead of as bare page text
- **The HTTP bridge wraps `comet_ask`'s answer** - the answer comes back in the UNTRUSTED markers with a fresh nonce, as it always did over stdio, instead of as bare page text; `COMET_DISABLE_UNTRUSTED_MARKERS=1` opts out as before
- **Mode clicks and keys land only on Perplexity** - before each pointer click of a mode switch, and before the Escape that closes the mode menu, the server asks the browser for the tab's origin and sends the input only when it is exactly `https://www.perplexity.ai`; on any other site, including one whose address merely contains `perplexity.ai`, or when the browser cannot report the origin, the switch fails and nothing is clicked or pressed. The Escape used to be sent to whatever page the tab showed. Which tab `comet_mode` switches in is the rule of *`comet_ask` and `comet_mode` never use Comet's sidecar or a page of yours*, above
- **The live batteries wait for a call as long as they allow it** - each call's limit now reaches the MCP SDK, whose 60-second default had stopped the Pro battery's longer calls, the Deep research ask among them, with `MCP error -32001: Request timed out`; a call past its limit fails with `TIMEOUT after <limit>ms`, as before
- **The no-pro battery's screenshot check fails on an error** - `[5.1]` used to pass any reply holding an image or a long text, so a long error message counted as a screenshot; an error result now fails it
- **A forged close marker in page text is neutralised** - text read from the page that imitates the `[END UNTRUSTED PAGE CONTENT nonce=…]` marker the server writes is now defused like a forged opening marker, before it is wrapped
- **`comet_ask` says when its time ran out** - when the timeout runs out before Comet has finished, the result says the answer may be incomplete, gives the page's status, the partial answer and the steps seen wrapped as page text, and names `comet_poll` to follow the task, which stays active, or `comet_stop` to cancel it. The stdio server used to return a long partial text as if it were the answer, and the HTTP bridge returned whatever it had read, or `Task timed out or no response received`, as a successful answer. Over the bridge the timeout is still a successful call, its `content` saying the answer may be incomplete. The Pro battery's `[2.4]`, which checks this, leaves its known-failures list
- **`comet_ask` types and submits the prompt with Comet in the background** - the prompt used to be typed with `document.execCommand`, which reports success and types nothing while Comet's window has no focus, the normal state when an MCP client drives it, so the ask failed two steps later with `Prompt text not found in input`. The ask now selects Perplexity's input bar, inserts the prompt with the browser's own text input through the DevTools protocol, reads the field back to check it holds the prompt, and presses a real Enter; when Enter has not sent it within a few seconds, it clicks the input bar's Submit button. The browser drops key presses and clicks to a tab whose window is behind others, so around the Enter and the click, and only then, the ask has the browser treat the tab as focused and visible through the DevTools protocol's focus emulation, turned off again whether the submit worked or failed; Comet's window is not raised. The text, the key, the click and the focus emulation go only to a tab the browser reports on `https://www.perplexity.ai`. A failure names its step (`The prompt was not sent: the input bar was not found on the page`, `…: the text was not taken, …` or `…: the submit was not taken, …`), and the task it started is no longer followed: `comet_poll` then reports `Status: IDLE` and says the last task's prompt was not sent, without reading the page, whatever answer an earlier ask left there. The synthetic key events and the form submit event the ask used to fall back on are gone. The Pro battery's `[2.5]` no longer fails on the typing, but stays on its known-failures list for another reason: it follows `[2.4]`, whose long essay may still be streaming, and its submit is not taken, most likely because Perplexity takes no new prompt while it is still answering, which is not yet confirmed

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
