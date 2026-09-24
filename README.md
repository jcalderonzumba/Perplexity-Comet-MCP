# Perplexity Comet MCP

[![npm version](https://img.shields.io/npm/v/perplexity-comet-mcp.svg)](https://www.npmjs.com/package/perplexity-comet-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/perplexity-comet-mcp.svg)](https://nodejs.org)
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
| Completion Detection | Fixed timeout | Stability-based |
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

### Install via npm

```bash
npm install -g perplexity-comet-mcp
```

### Install from Source

```bash
git clone https://github.com/RapierCraft/perplexity-comet-mcp.git
cd perplexity-comet-mcp
npm install
npm run build
```

### Configure Claude Code

Add to your Claude Code MCP settings (`~/.claude/settings.json` or VS Code settings):

```json
{
  "mcpServers": {
    "comet-bridge": {
      "command": "node",
      "args": ["/path/to/perplexity-comet-mcp/dist/index.js"]
    }
  }
}
```

**Windows Users:** Use the full Windows path:

```json
{
  "mcpServers": {
    "comet-bridge": {
      "command": "node",
      "args": ["C:\\Users\\YourName\\perplexity-comet-mcp\\dist\\index.js"]
    }
  }
}
```

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
  - timeout (optional): Max wait time in ms (default: 120000)

Returns: Complete response text
```

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

Check status and progress of ongoing tasks. Returns the response if completed.

```
Parameters: None
Returns: Status (IDLE/WORKING/COMPLETED), steps taken, or final response
```

**Example:**
```
> comet_poll
Status: WORKING
Browsing: https://github.com/trending
Current: Scrolling page

Steps:
  - Preparing to assist you
  - Navigating to github.com
  - Clicking on Trending
  - Scrolling page
```

---

### comet_stop

Halt the current agentic task if it goes off track.

```
Parameters: None
Returns: Confirmation message
```

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

With a mode, it opens the mode menu with real pointer clicks, selects the mode's item, and opens the menu again to read which item is checked. It says `Switched to <mode> mode` only when the menu and the button both show the new mode. Otherwise it returns an error naming what the page showed. Either way it closes the menu. If the tab is not on Perplexity, it opens Perplexity's home page first. Before every click it asks the browser which site the tab shows, and it clicks only on Perplexity's own site, `https://www.perplexity.ai`: on any other site the switch fails and nothing is clicked.

Text read from the page is wrapped in the same UNTRUSTED markers as answers. Perplexity puts the mode back to Search when the page navigates, for example for a new chat.

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
| `comet-ai.ts` | Perplexity interaction, prompt submission, response extraction |
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

### Live test batteries

Both batteries start the built server (`npm run build` first) and drive your local Comet through it: connect, tabs, screenshots, mode, and for the Pro battery, questions and agentic browsing.

- **No-pro** (`tests/run-no-pro.mjs`): needs Comet signed in and already running with its debug port on the server's port (`COMET_PORT`, 9223 by default); spends no Perplexity Pro queries. `npm run preflight` runs it on every pull request, with a ten-minute ceiling. If your Comet listens on another port, set `COMET_PORT` to it, for example `COMET_PORT=9222 npm run preflight`: the battery checks that port and starts the server on it.
- **Pro** (`tests/run-all.mjs`): needs Comet signed in to Perplexity Pro and **spends Pro queries**. It is run by hand when a change touches asking, polling, modes or agentic browsing, and the pull request records the result.

The no-pro battery prints one line per check: its verdict, its id, and what the tool replied.

- `PASS`: the check's condition held.
- `FAIL`: it did not, or the call threw or timed out. This fails the battery.
- `KNOWN`: it failed, and it is on the known-failures list in `tests/lib/battery-score.mjs`, which gives the reason and the plan that owns the fix. It does not fail the battery. The line still shows the actual reply, so a change in why it fails stays visible.
- `UNEXPECTED PASS`: it passed although it is listed. This fails the battery until the entry is removed.

The battery first asks the debug port itself whether Comet answers. If it does not, `[1.2]` fails with `Comet is not running with its debug port on <port>` and no tool is called, so the battery never launches Comet or restarts one running on another port. If connect fails, the other checks are not run and count as failed. The battery ends with a summary, in which an unexpected pass counts as failed, and exits non-zero on any failure:

```
Results: 8 passed, 0 failed, 2 known
```

Today the list holds the switches to the `labs` mode, which Perplexity's input bar no longer offers, and to the `learn` mode, which `comet_mode` does not switch to yet.

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
