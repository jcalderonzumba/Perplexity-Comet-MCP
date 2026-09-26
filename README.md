# Perplexity Comet MCP

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-green.svg)](https://modelcontextprotocol.io/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20WSL-lightgrey.svg)]()

A production-grade MCP (Model Context Protocol) server that bridges Claude Code with Perplexity's Comet browser for autonomous web browsing, research, and multi-tab workflow management.

---

## Why Perplexity Comet MCP?

| Approach | Limitation |
|----------|------------|
| **Search APIs** | Static text, no interaction, no login support |
| **Browser Automation** | Single-agent model overwhelms context, fragments focus |
| **Perplexity Comet MCP** | Claude codes while Comet handles browsing autonomously |

This is a significantly enhanced fork of [hanzili/comet-mcp](https://github.com/hanzili/comet-mcp) with Windows support, smart completion detection, robust connection handling, and full tab management.

---

## Features

### Core Capabilities

- **Autonomous Web Browsing** - Comet navigates, clicks, types, and extracts data while Claude focuses on coding
- **Deep Research Mode** - Leverage Perplexity's research capabilities for comprehensive analysis
- **Login Wall Handling** - Access authenticated content through real browser sessions
- **Dynamic Content** - Full JavaScript rendering and interaction support

### Enhanced Features (New in This Fork)

| Feature | Description |
|---------|-------------|
| **Windows/WSL Support** | Full compatibility with Windows and WSL environments |
| **Tab Management** | Track, switch, and close browser tabs with protection |
| **Smart Completion** | Detect response completion without fixed timeouts |
| **Auto-Reconnect** | Exponential backoff recovery from connection drops |
| **One-Shot Reliability** | Pre-operation health checks for consistent execution |
| **Agentic Auto-Trigger** | Automatically triggers browser actions from natural prompts |

---

## Comparison with Original

| Capability | Original | Enhanced |
|------------|----------|----------|
| Platform Support | macOS | Windows, WSL, macOS |
| Available Tools | 6 | 8 (+comet_tabs, +comet_upload) |
| Completion Detection | Fixed timeout | Read from the page: the latest turn's answer, once complete |
| Connection Recovery | None | Auto-reconnect with backoff |
| Tab Management | None | Full registry and control |
| Health Monitoring | None | Cached health checks |
| Last Tab Protection | None | Prevents browser crash |

---

## Installation

### Prerequisites

- Node.js 18 or higher
- [Perplexity Comet Browser](https://www.perplexity.ai/comet) installed
- Claude Code or compatible MCP client

This project is not published to npm. The npm package named `perplexity-comet-mcp` is the upstream project this one started from, not this server. Run it from GitHub pinned to a commit, or from a clone.

### Run from GitHub, pinned to a commit

npx clones the repository at that commit and builds it on first use, then reuses the build while the commit stays the same. Pick a commit on `main` and use its full SHA:

```bash
npx -y github:jcalderonzumba/Perplexity-Comet-MCP#<commit-sha>
```

The first start clones and builds, which can take longer than an MCP client waits for a server; run the command once by hand, and stop it with Ctrl-C, before adding it to your client. To move a Claude Code setup to a newer commit, use `npm run bridge:update` from a clone (below); for another client, run the new commit once by hand, then change the SHA in its configuration.

### Install from Source

```bash
git clone https://github.com/jcalderonzumba/Perplexity-Comet-MCP.git
cd Perplexity-Comet-MCP
npm ci
npm run build
```

### Configure Claude Code

Add the server with `claude mcp add`. `-s user` makes it available in every project; set `COMET_PORT` to the port Comet's remote debugging listens on, since the server's default is 9223:

```bash
# Pinned to a commit on GitHub
claude mcp add -s user comet-bridge -e COMET_PORT=9222 -- \
  npx -y github:jcalderonzumba/Perplexity-Comet-MCP#<commit-sha>

# From a clone
claude mcp add -s user comet-bridge -e COMET_PORT=9222 -- \
  node /path/to/Perplexity-Comet-MCP/dist/index.js
```

`claude mcp get comet-bridge` shows what it runs. When nothing answers on that port, `comet_connect` starts Comet with remote debugging on it; if Comet is already running without it, `comet_connect` stops Comet and starts it again, on macOS and Windows (under WSL it only starts Comet).

To move a pinned `comet-bridge` to a newer commit, run this from a clone of this repository:

```bash
npm run bridge:update                 # the tip of main on GitHub
npm run bridge:update -- <commit-sha> # a given commit, for example to go back
```

It builds that commit with npx and asks it for its tools first, and replaces the user-scope `comet-bridge` entry only when every tool answers; if adding the new entry fails, it puts the old one back. It keeps the entry's environment, with `COMET_PORT` taken from your environment when you set it there, and does nothing when the entry already runs that commit on that port. A running Claude Code session keeps the server it started with; start a new session to run the new build. It needs `git`, `npx` and `claude` on `PATH`, and runs on macOS and Linux.

### Other MCP clients

Clients configured with an `mcpServers` JSON file take the same command, arguments and environment:

```json
{
  "mcpServers": {
    "comet-bridge": {
      "command": "node",
      "args": ["/path/to/Perplexity-Comet-MCP/dist/index.js"],
      "env": { "COMET_PORT": "9222" }
    }
  }
}
```

**Windows Users:** Use the full Windows path, for example `"args": ["C:\\Users\\YourName\\Perplexity-Comet-MCP\\dist\\index.js"]`.

---

## Tools Reference

### comet_connect

Establish connection to Comet browser. Auto-launches if not running.

```
Parameters: None
Returns: Connection status message
```

**Example:**
```
> comet_connect
Comet started with debug port 9223
Connected to Perplexity (cleaned 2 old tabs)
```

---

### comet_ask

Send a prompt to Comet and wait for the complete response. Automatically triggers agentic browsing for URLs and action-oriented requests.

```
Parameters:
  - prompt (required): Question or task for Comet
  - newChat (optional): Start fresh conversation (default: false)
  - context (optional): Text placed before the prompt, such as file contents
  - timeout (optional): Max wait time in ms (default: 120000)

Returns: The complete answer, or, when the timeout runs out first, what the
page shows so far, said to be possibly incomplete
```

The answer is page content, so it comes back wrapped in UNTRUSTED markers carrying a fresh nonce, over stdio and the HTTP bridge alike. The stdio server and the HTTP bridge run the same ask: the same arguments, the same wait and the same result text.

The answer is the latest turn's answer, whole and nothing else: in a thread with earlier turns, none of their text, and no length limit. A one-word answer counts as an answer, and comes back as soon as Comet has finished it: the ask returns once the page reads the answer complete, whatever its length. The page reads as still answering while its input bar shows Perplexity's stop control, labelled `Stop response (Esc)`; on a page in another language, where that label is translated, the control's filled stop icon counts too, on any input-bar button but `Stop dictation`, so an answer in progress never reads as complete. Stopping, by `comet_stop` or before an ask types, finds the control by its English label alone, and the signs of a finished answer, such as the follow-up placeholder, are read in English and Russian only. It returns only its own question's answer: the answer of a turn the page shows after the one it showed before the prompt was sent, even when its text is the same as an earlier turn's, and never an earlier turn's answer, however the page read before the prompt was sent. Its paragraphs, headings, list items and table rows come back as blocks separated by a blank line, with list items marked `- ` or numbered, a table's cells separated by ` | `, and a code block as its code alone, without its caption. The citation chips Perplexity shows beside a sentence are left out.

The ask never types while Comet is still answering, that is while Perplexity's input bar shows the stop control: a prompt typed while an earlier answer may still be streaming has been seen not to be taken, most likely because Perplexity takes no new prompt while it answers, though that is not confirmed. So before it types, the ask looks for that control in the page it asks in. When the answer in progress is the server's own, left by an earlier `comet_ask` that ran out of time or is still waiting (a new ask replaces that task, and its answer could no longer be followed), the ask stops it as `comet_stop` does, and its result starts with the line `Comet was still answering this server's previous question, so that answer was stopped before this prompt was sent.`; when that stop is not taken, the ask fails without typing. An answer the server did not start, perhaps one you asked in Comet yourself, is never stopped: the ask waits for it to finish, within its own timeout, then types the prompt; when the answer outlasts the timeout, the ask fails without typing, with `The prompt was not sent: Comet was still answering a question this server did not ask when this ask's <timeout> ms ran out, …`, which names `comet_stop` and `comet_poll`. A new chat opens Perplexity's home page first, which shows no answer in progress.

When `comet_stop` stops the task while the ask waits for its answer, or a newer `comet_ask` replaces it, the ask returns at its next read of the page. Its result is not the answer and says so: its first line reads `The answer may be incomplete: this ask's task was stopped, by comet_stop or by a newer comet_ask, before Comet finished answering.`, then come `Status: STOPPED`, the partial answer so far (or `No answer text yet.`) and the steps seen, all page text wrapped. The stopped task's answer is never taken for the answer later. When the task is stopped or replaced while the ask still waits to send its prompt, for an answer it did not start or during the mode step, the ask types nothing: its result reads `The prompt was not sent: this ask's task was stopped, by comet_stop or by a newer comet_ask, while it waited to send it.`, then `Status: STOPPED`.

The timeout counts from the moment the ask starts waiting: for an answer still in progress that the server did not start, then for its own, and the time spent on the first is taken from the second. When it runs out before Comet has finished, the result is not the answer and says so: its first line reads `The answer may be incomplete: this ask's <timeout> ms ran out before Comet finished answering.`, then come the page's status, the partial answer so far (or `No answer text yet.`) and the steps seen, all page text wrapped, and a last line saying the task is still active, so `comet_poll` can follow the answer until it is complete, or `comet_stop` cancel it. Over the HTTP bridge this is a successful call (`success: true`) whose `content` carries that text.

The arguments are checked before anything reaches the browser. An empty prompt is refused, and so are a `prompt` or `context` that is not text, a `timeout` that is not a positive number of milliseconds (text, a negative number), and a `newChat` that is not `true` or `false`; an absent or zero `timeout` means the default, and a numeric string its number. A refusal, or an ask that fails, is an error result starting `Error:` (`isError` over stdio, `success: false` over the HTTP bridge). When the connection to Comet is lost, the ask starts Comet, or finds it running, on the debug port `COMET_PORT` names, and reconnects.

Comet's window does not need to be in front, or to have focus: an MCP client normally drives it from behind other windows. The prompt is typed and submitted with the browser's own input, sent through the DevTools protocol rather than made up in page script. The ask selects Perplexity's input bar, inserts the prompt there, and reads the field back to check it holds the prompt; then it presses Enter, and when Enter has not sent the prompt within a few seconds, it clicks the input bar's Submit button. A prompt counts as sent once the field empties or the page shows a new turn of the thread, its question, which Perplexity shows at once. The browser takes the inserted text in a tab that is hidden, one not selected in its window, but drops key presses and clicks there, and may do the same for the selected tab of a window behind others; so for the submit alone the ask has the browser treat the tab as focused and visible (the DevTools protocol's focus emulation), and turns that off again once the prompt is sent or the submit has failed; Comet's window is never raised or brought to the front. The text, the key press, the click and the focus emulation are sent only while the browser reports the tab on `https://www.perplexity.ai`. When a step fails, the ask stops before waiting for an answer, and its error names the step: `The prompt was not sent: the input bar was not found on the page`, `The prompt was not sent: the text was not taken, …` (the field reads back empty, or holds other text), or `The prompt was not sent: the submit was not taken, …`. A `comet_poll` after such a failure, or after an ask that could not reach Comet at all, reports `Status: IDLE` and says the last task's prompt was not sent, whatever the page shows.

The ask is typed in Perplexity's main page, never in Comet's sidecar (the side panel's chat, at `https://www.perplexity.ai/sidecar`) and never in a page of your own. The server tells them apart by the address the browser reports for each tab, never by what the page says of itself: a tab is Perplexity's main page when it is on `https://www.perplexity.ai` and not in the sidecar, and an address that only mentions Perplexity, in its path, its query or a lookalike host, is not. When the connected tab is not Perplexity's main page, the ask moves to one already open; when none is open, it opens Perplexity's home page in a new tab, remembers that it opened it, and asks there, and the next ask reuses it. `comet_ask` and `comet_mode` keep that record together, so a tab either of them opened is known as opened by the server. A new chat then opens Perplexity's home page in that tab. The ask never navigates or closes the sidecar or a page of yours, and while it waits for the answer, and when `comet_poll` reads it, the connection is brought back to Perplexity's main page the same way, without opening a tab.

The mode `comet_mode` last set carries over to every ask. Perplexity puts the mode back to Search whenever the page navigates, so after its own navigation (a new chat, a reconnect) and before it types the prompt, `comet_ask` reads the page's mode and switches it back when it differs. Without a mode set by `comet_mode`, or with the page already in it, nothing is clicked and the result is just the answer. When the mode cannot be put back, the ask still runs, and its result starts with a line beginning `Mode not applied:` that says which mode and why, followed by a blank line and the answer.

**Examples:**

```
# Simple research query
> comet_ask "What are the latest features in Python 3.12?"

# Agentic browsing (auto-triggered)
> comet_ask "Go to github.com/trending and list top Python repos"

# Site-specific data extraction
> comet_ask "Check the price of iPhone 15 on amazon.com"
```

---

### comet_poll

Check the status of the task the last `comet_ask` started. Returns the answer once it is complete.

```
Parameters: None
Returns: Status (IDLE/WORKING/COMPLETED/STOPPED), the answer once complete, or
the partial answer and the steps so far, said to be possibly incomplete
```

The first line is always the status. With no task, a finished task that started more than five minutes ago, or a task whose prompt was never sent, it is `Status: IDLE`. A task whose answer is complete is `Status: COMPLETED`, followed by the answer. A poll applies the same rules as `comet_ask` to decide that an answer is complete, so the answer to a task whose ask ran out of time comes back only once Comet has finished it, and never as the answer that was on the page before the prompt was sent. Until then the poll reports `Status: WORKING` and says the answer may be incomplete, with the partial answer so far (or `No answer text yet.`), the tab the agent is browsing, the current step and the steps seen. After `comet_stop` has stopped the task, the poll reports `Status: STOPPED`, the task and the steps seen, says there is no answer to follow, and reads nothing from the page, whatever the stopped page shows; once the task started more than five minutes ago, it reports `Status: IDLE`. When the page fails while a poll reads it, the poll is an error result (`isError` over stdio, `success: false` over the HTTP bridge) whose text starts `Status: UNKNOWN`, gives the page's error message wrapped as page text, and says the task is still active, so a later poll can follow it.

Every piece of page text in the result, the answer, the partial answer, the browsing address and the steps, comes back wrapped in UNTRUSTED markers, over stdio and the HTTP bridge alike; the two run the same poll and give the same text.

**Example:**
```
> comet_poll
Status: WORKING
Task: task_1760000000000_…
The answer may be incomplete: Comet is still answering.

Partial answer so far:
[BEGIN UNTRUSTED PAGE CONTENT …]
The top-ranked repository today is
[END UNTRUSTED PAGE CONTENT …]

Progress:
[BEGIN UNTRUSTED PAGE CONTENT …]
Browsing: https://github.com/trending
Current: Scrolling page
Steps:
  • Navigating to github.com
  • Clicking on Trending
[END UNTRUSTED PAGE CONTENT …]

[Use comet_poll again to follow the answer until it is complete, comet_stop to interrupt, or comet_screenshot to see current page]
```

---

### comet_stop

Halt the current agentic task if it goes off track.

```
Parameters: None
Returns: "Agent stopped", "No active agent to stop" when the page shows
nothing to stop, or an error when the page did not take the stop
```

The stop presses Perplexity's own stop control, the button its input bar shows while it answers, labelled `Stop response (Esc)`, and no other button: not a pane toggle with a square icon, not `Stop dictation`, not the read-aloud player's `Stop`. It looks for it in Perplexity's main page only, moving the connection there as `comet_ask` does, never in the sidecar or a page of yours. The click is the browser's own input, sent only while the browser reports the tab on `https://www.perplexity.ai`, and, as for the ask's submit, the browser treats the tab as focused and visible around the click alone, so it lands with Comet's window behind others. The result is `Agent stopped` once the stop control has gone, and `No active agent to stop`, with nothing clicked, when no main page is open or it shows no stop control. When the control still shows a few seconds after the click, the result is an error, `The answer was not stopped: …`, and the task goes on.

When it stops the agent, the task ends: an ask still waiting for its answer returns saying it was stopped, an ask still waiting to send its prompt sends nothing, and `comet_poll` reports `Status: STOPPED` and no longer follows the answer.

---

### comet_screenshot

Capture a screenshot of the current browser view.

```
Parameters: None
Returns: PNG image data
```

---

### comet_tabs

View and manage browser tabs. Essential for multi-tab workflows.

```
Parameters:
  - action (optional): "list" (default), "switch", or "close"
  - domain (optional): Domain to match (e.g., "github.com")
  - tabId (optional): Specific tab ID

Returns: Tab listing or action confirmation
```

**Examples:**

```
# List all external tabs
> comet_tabs
2 browsing tab(s) open:
  - AGENT-BROWSING: github.com [ACTIVE]
    URL: https://github.com/trending
  - AGENT-BROWSING: stackoverflow.com
    URL: https://stackoverflow.com/questions

# Switch to a tab
> comet_tabs action="switch" domain="stackoverflow.com"
Switched to stackoverflow.com (https://stackoverflow.com/questions)

# Close a tab (protected if last tab)
> comet_tabs action="close" domain="github.com"
Closed github.com
```

**Tab Protection:**
- Cannot close the last external browsing tab (prevents Comet crash)
- Internal tabs (chrome://, Perplexity UI) are automatically filtered

---

### comet_mode

Read or switch Perplexity's mode.

```
Parameters:
  - mode (optional): "search", "research", "labs", or "learn"

Returns: the current mode read from the page, or confirmation that the switch happened
```

| Mode | What it selects |
|------|-----------------|
| search | Search, Perplexity's default |
| research | Deep research |
| labs | Not available: Perplexity's input bar no longer offers Labs, so the call fails saying so |
| learn | Not available yet: the call fails saying so |

Without a mode, `comet_mode` reads the mode from the mode button in Perplexity's input bar. When the button shows something other than these modes, or there is no button, it reports `unknown` and quotes what it saw. When the page fails while it is read, it reports `unknown` as an error and quotes the page's error message.

With a mode, it opens the mode menu with real pointer clicks, selects the mode's item, and opens the menu again to read which item is checked. It says `Switched to <mode> mode` only when the menu and the button both show the new mode. Otherwise it returns an error naming what the page showed. Either way it closes the menu. Before a switch it goes to Perplexity's main page by the same rule as `comet_ask`: never the sidecar or a page of yours, but a Perplexity tab already open, or Perplexity's home page in a new tab when none is, remembered as opened by the server in the record `comet_ask` keeps. No tab is navigated. Before every click, and before the Escape that closes the menu, it asks the browser which site the tab shows, and it sends the input only on Perplexity's own site, `https://www.perplexity.ai`: on any other site, or when the browser cannot say, the switch fails and nothing is clicked or pressed.

Text read from the page is wrapped in the same UNTRUSTED markers as answers. Perplexity puts the mode back to Search when the page navigates, for example for a new chat; the server remembers the mode `comet_mode` last set, and `comet_ask` switches back to it before each ask (see `comet_ask`).

---

### comet_upload

Upload files to file input elements on web pages. Essential for posting images to social media, attaching files to forms, or uploading documents.

```
Parameters:
  - filePath (required): Absolute path to the file to upload
  - selector (optional): CSS selector for specific file input
  - checkOnly (optional): If true, only checks what file inputs exist

Returns: Success message or error with available inputs
```

**Examples:**

```
# Upload an image to the first file input found
> comet_upload filePath="/home/user/screenshot.png"
File uploaded successfully: /home/user/screenshot.png

# Check what file inputs exist on the page
> comet_upload filePath="dummy" checkOnly=true
Found 2 file input(s) on the page:
  1. #image-upload
  2. input[name="attachment"]

# Upload to a specific input
> comet_upload filePath="/home/user/doc.pdf" selector="#attachment-input"
File uploaded successfully: /home/user/doc.pdf
```

**Workflow for posting images:**
1. Navigate to the post creation page (e.g., Reddit, Twitter)
2. Use `comet_upload checkOnly=true` to find file inputs
3. Use `comet_upload filePath="..." selector="..."` to attach the file
4. Continue with form submission

---

## Architecture

```
┌─────────────────┐     MCP Protocol      ┌──────────────────┐
│   Claude Code   │ ◄──────────────────► │  Perplexity      │
│   (Your IDE)    │                       │  Comet MCP       │
└─────────────────┘                       └────────┬─────────┘
                                                   │
                                          Chrome DevTools
                                            Protocol
                                                   │
                                          ┌────────▼─────────┐
                                          │  Comet Browser   │
                                          │  (Perplexity)    │
                                          └──────────────────┘
                                                   │
                                          ┌────────▼─────────┐
                                          │   External       │
                                          │   Websites       │
                                          └──────────────────┘
```

### Key Components

| Component | Purpose |
|-----------|---------|
| `index.ts` | MCP server and tool handlers |
| `cdp-client.ts` | Chrome DevTools Protocol client with reconnection logic |
| `core/` | The tool core both servers share: `comet_ask`, `comet_poll` and `comet_stop`, with typing and submitting the prompt in `core/ask-send.ts`, when an answer is complete and the ask's own in `core/answer-watch.ts`, stopping it in `core/ask-stop.ts`, and the tab they use in `core/ask-tab.ts` and `core/perplexity-tab.ts`, and `comet_mode` |
| `perplexity-pages.ts` | Perplexity's origin and home page, and the one rule that says which tab is Perplexity's main page |
| `comet-ai.ts` | Reading the answer and its status from the page |
| `types.ts` | TypeScript interfaces for tabs, state, and CDP types |

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `COMET_PATH` | Custom path to Comet executable | Auto-detected |
| `COMET_PORT` | CDP debugging port | 9223 |

### Custom Comet Path

```bash
# Windows
set COMET_PATH=C:\Custom\Path\comet.exe

# macOS/Linux
export COMET_PATH=/custom/path/to/Comet.app/Contents/MacOS/Comet
```

---

## Troubleshooting

### Connection Issues

**Problem:** `Error: Failed to list targets: ECONNREFUSED`

**Solutions:**
1. Ensure Comet browser is installed
2. Close any existing Comet instances
3. Run `comet_connect` to auto-start with correct flags

---

**Problem:** `WebSocket connection closed` during long tasks

**Solution:** This version handles reconnection automatically. If persistent, increase timeout:

```
comet_ask prompt="..." timeout=180000
```

---

**Problem:** `comet_ask` fails with `The prompt was not sent: …`

**Explanation:** The ask checks each step of sending the prompt, and the error names the one that failed. Comet does not need to be in front: the prompt is typed and submitted with the browser's own input, which works while Comet's window is behind others. `Comet was still answering a question this server did not ask` means an answer the server did not start, perhaps one of yours, was still running when the ask's timeout ran out, and the ask never stops such an answer: wait for it, or stop it with `comet_stop`, then ask again. The input bar not found usually means the tab is not on Perplexity's search page; run `comet_ask` with `newChat: true` to start from Perplexity's home page. The text or the submit not taken means Perplexity's page did not accept the input. A Perplexity tab behind another tab in its window drops key presses and clicks, and a window behind others may do the same, so the ask has the browser treat the tab as focused while it presses Enter or clicks Submit. Take a `comet_screenshot` to see the page, then ask again.

---

### Windows-Specific Issues

**Problem:** `ECONNRESET` errors on Windows

**Solution:** This version includes PowerShell-based fetch workarounds. Ensure:
1. PowerShell is available in PATH
2. No firewall blocking localhost:9223

---

**Problem:** Comet not found on Windows

**Solution:** Set custom path:
```bash
set COMET_PATH=%LOCALAPPDATA%\Perplexity\Comet\Application\comet.exe
```

---

### WSL-Specific Issues

**Problem:** `WSL cannot connect to Windows localhost:9223`

**Explanation:** WSL2 uses a separate network namespace by default. The MCP uses Chrome DevTools Protocol (CDP) which requires WebSocket connections to Windows localhost.

**Solution:** Enable WSL mirrored networking:

1. Create or edit `%USERPROFILE%\.wslconfig` (e.g., `C:\Users\YourName\.wslconfig`):
```ini
[wsl2]
networkingMode=mirrored
```

2. Restart WSL:
```powershell
wsl --shutdown
```

3. Open a new WSL terminal and try again.

**Alternative:** Run Claude Code from Windows PowerShell instead of WSL.

---

**Problem:** `UNC paths are not supported` warnings

**Explanation:** This is a benign warning from PowerShell when launched from WSL. The MCP handles this automatically.

---

### Tab Management Issues

**Problem:** `Cannot close - this is the only browsing tab`

**Explanation:** This is intentional protection. Comet requires at least one external tab. Open another tab first, then close the unwanted one.

---

## Development

Working on this repository needs Node 18 or later, `jq`, `git`, and for the live batteries the [Comet browser](https://www.perplexity.ai/comet) signed in to Perplexity. The project's instructions for people and agents are in [`AGENTS.md`](AGENTS.md).

```bash
npm ci
git config core.hooksPath .githooks   # once per clone
npm run check                         # before every commit
```

| Command | What it does |
|---|---|
| `npm run build` · `npm run dev` | compile to `dist/`, once or watching |
| `npm run check` | the per-commit gate: Biome, both typechecks, every Vitest test |
| `npm run preflight` | the per-PR gate: `check`, a clean build, the package contents, the live no-pro battery; stamps the commit |
| `npm test` · `npm run test:watch` | Vitest, once or watching |
| `npm run lint` · `npm run format` | Biome on its own; `format` rewrites files |
| `npm run test:live` | the live no-pro battery |
| `npm run test:live:pro` | the live Pro battery |
| `npm run bridge:update [-- <sha>]` | points your user-scope Claude Code `comet-bridge` at this repository's build at a commit, by default the tip of `main` on GitHub |

### Live test batteries

Both batteries start the built server (`npm run build` first) and drive your local Comet through it: connect, tabs, screenshots, mode, and for the Pro battery, questions and agentic browsing.

- **No-pro** (`tests/run-no-pro.mjs`): needs Comet signed in and already running with its debug port on the server's port (`COMET_PORT`, 9223 by default); spends no Perplexity Pro queries. `npm run preflight` runs it on every pull request, with a ten-minute ceiling. If your Comet listens on another port, set `COMET_PORT` to it, for example `COMET_PORT=9222 npm run preflight`: the battery checks that port and starts the server on it.
- **Pro** (`tests/run-all.mjs`): needs Comet signed in to Perplexity Pro and already running with its debug port on the server's port (`COMET_PORT`, 9223 by default), and **spends Pro queries**, one Deep research query among them. It is run by hand when a change touches asking, polling, modes or agentic browsing, and the pull request records the result. Like the no-pro battery, it starts the server on the port it checks and asks that port first: when nothing answers, `[1.2]` fails and no tool is called, and when connect fails, no other check is run or scored. It scores its checks as the no-pro battery does, below, against a known-failures list of its own, and exits non-zero on any failure or unexpected pass.

Each battery prints one line per check: its verdict, its id, and what the tool replied.

- `PASS`: the check's condition held.
- `FAIL`: it did not, or the call threw or timed out. This fails the battery.
- `KNOWN`: it failed, and it is on its battery's known-failures list in `tests/lib/battery-score.mjs` (`NO_PRO_KNOWN_FAILURES` or `PRO_KNOWN_FAILURES`), which gives the reason and the plan that owns the fix. The batteries share some check ids, and an entry excuses its check in its own battery alone. It does not fail the battery. The line still shows the actual reply, so a change in why it fails stays visible.
- `UNEXPECTED PASS`: it passed although it is listed. This fails the battery until the entry is removed.

The no-pro battery first asks the debug port itself whether Comet answers. If it does not, `[1.2]` fails with `Comet is not running with its debug port on <port>` and no tool is called, so the battery never launches Comet or restarts one running on another port. If connect fails, the other checks are not run and count as failed. The battery ends with a summary, in which an unexpected pass counts as failed, and exits non-zero on any failure:

```
Results: 9 passed, 0 failed, 1 known
```

The Pro battery ends with the same summary line. Its checks hold only on the answer or the refusal each expects:

- An ask's check passes on a final answer that names what was asked (`VERIFIED`, `Paris`, `Artemis`, the page heading `Example Domain`), never on an error, a login page, or a result saying the answer may be incomplete or the task may still be in progress. `[1.5]` and `[2.5]`, whose prompts name the word themselves, also fail on a reply that holds the prompt read back from the page. Each ask gets a `timeout` shorter than the battery's own limit on the call, so a slow answer is judged on what the server returns.
- `[2.2]` asks a follow-up in the same chat, and fails when the follow-up returns the previous turn's answer; `[2.3]` gives a number in one new chat, asks for it in another, and passes when that ask answers in a thread of its own: the battery reads the addresses of Comet's pages through the debug port after each ask, and a Perplexity thread (`/search/<id>`) must be open after the second that was not after the first. What the answer knows is not judged, since Perplexity's memory, when it is on for the account, carries what one thread was told into a new one. Its line counts the threads and never prints their addresses.
- `[2.4]` gives the ask 3 seconds for a long essay, and passes when it returns within 8 seconds saying the answer may be incomplete and naming `comet_poll` to follow it.
- `[2.6-whole-answer]` asks for three paragraphs starting `ALPHA`, `BRAVO` and `CHARLIE`, and passes only when all three come back, in order, each word opening a line; the prompt names them mid-sentence, so a reply that reads it back fails.
- `[3.2-agent-tab]` lists the tabs before and after an ask that sends the agent to `example.org`, and passes when a tab on that site has opened; `[3.3-tabs-kept]` passes when, moreover, every tab open before the ask is still open after it, at the same address. Its line counts the tabs and never prints their addresses.
- `[3.4]` asks for the top trending GitHub repository, and passes when the answer names one as `owner/name`, on its own or in its `github.com` address, with a star count; a web address's path such as `news.site/trending` is not a repository, and a reply that names `example.com` or `example.org`, the sites of the browsing asks before it, carries one of their answers and fails.
- The poll, stop, tab, upload and empty-prompt checks pass on the status line, the confirmation or the error each expects: `[4.1]` on `Status: IDLE` or `COMPLETED`, `[4.3]` on `Agent stopped`, `[4.3b]` on `Status: STOPPED` or `IDLE`, `[6.3]` on a switch to the `example.com` tab, `[6.4]` on its close or on the refusal to close the only browsing tab, `[8.3]` and `[8.4]` on the errors naming the missing selector and the missing file, and `[9.2]` on the refusal of an empty prompt. The screenshot, tab-listing and mode checks are the no-pro battery's own, and `[7.4-research-workflow]` runs the research workflow: `comet_mode research`, then `comet_ask` with `newChat: true`, then `comet_mode`; it passes when the ask's result has no `Mode not applied:` line and the page still reads `research`, and it puts Search back afterwards.

The Pro battery's known-failures list names the Agentic browsing plan for Comet answering without opening the site a prompt names (`[3.1]`, `[3.2-agent-tab]`, `[3.3-tabs-kept]`, `[6.3]`), and lists the switch to `learn` as the no-pro battery does. `[3.4]` is not on it: its condition, a repository and its star count in the final answer, can hold whether or not the agent opens a tab, and it holds once the ask returns its own turn's answer.

The mode checks hold only on what the server really did. `[7.1]` and `[7.3-reconnect]` pass when `comet_mode` reads a mode from the page, and fail on an error or on `unknown`; `[9.4]`'s follow-up read is judged the same way. `[7.2-research]` and `[7.2-search]` pass on `Switched to <mode> mode`, and `[7.2-labs]` passes on the error saying Perplexity's input bar no longer offers Labs. Today the no-pro battery's known-failures list holds one check, the switch to the `learn` mode: Perplexity's input bar offers "Learn step by step", and `comet_mode` does not switch to it yet.

### Gates

There is no hosted CI. The git hooks refuse commits and pushes to `main`, and refuse to push a branch until its last commit is listed in both `.git/review-ok` (the phase review approved it) and `.git/preflight-ok` (`npm run preflight` passed on it). Changes follow the workflow in [`AGENTS.md`](AGENTS.md): a reviewed plan, one branch per plan phase built test-first, a phase review by a fresh-context reviewer, then preflight before the pull request. Claude Code users get the steps as the `/review-plan`, `/run-phase` and `/review-phase` skills.

---

## Contributing

This repository is maintained by its owner. How changes are made here is in [CONTRIBUTING.md](CONTRIBUTING.md) and [`AGENTS.md`](AGENTS.md).

---

## Attribution

This project is an enhanced fork of [comet-mcp](https://github.com/hanzili/comet-mcp) by [hanzili](https://github.com/hanzili).

### Key Enhancements by RapierCraft

- Windows and WSL platform support
- Tab management system (comet_tabs tool)
- Smart completion detection
- Auto-reconnect with exponential backoff
- Health check caching
- Agentic prompt auto-transformation
- Last tab protection
- Internal tab filtering

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Links

- [Perplexity Comet Browser](https://www.perplexity.ai/comet)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Claude Code](https://claude.ai/code)
- [Original comet-mcp](https://github.com/hanzili/comet-mcp)

---

Built with precision by [RapierCraft](https://github.com/RapierCraft)
