#!/usr/bin/env node

// Comet Browser MCP Server
// Claude Code ↔ Perplexity Comet bidirectional interaction
// Simplified to 6 essential tools

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createCdpAskCore } from "./cdp-ask-port.js";
import { cometClient, DEFAULT_PORT } from "./cdp-client.js";
import { createCdpModeTool } from "./cdp-mode-page.js";
import { createCdpPerplexityTab } from "./cdp-perplexity-tab.js";
import { cometAI } from "./comet-ai.js";
import {
  describeAskOutcome,
  describePollOutcome,
  describeStopOutcome,
} from "./core/ask-reply.js";
import { answerModeTool, COMET_MODE_TOOL } from "./core/mode-tool.js";
import { toStdioResult } from "./tool-results.js";
import { wrapUntrustedPageContent } from "./untrusted.js";
import {
  validateDomain,
  validateSelector,
  validateTabId,
  validateUploadPath,
} from "./upload-validator.js";

// Read version from package.json so the MCP `initialize` handshake reports
// the actually-shipped version. Hardcoding (previously "2.5.0" while
// package.json was "2.6.2") drifts every release.
function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
const SERVER_VERSION = readPackageVersion();

// validateUploadPath and validateTabId are imported from ./upload-validator.js

const TOOLS: Tool[] = [
  {
    name: "comet_connect",
    description: "Connect to Comet browser (auto-starts if needed)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "comet_ask",
    description:
      "Send a prompt to Comet/Perplexity and wait for the complete response (blocking). Ideal for tasks requiring real browser interaction (login walls, dynamic content, filling forms) or deep research with agentic browsing.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "Question or task for Comet - focus on goals and context",
        },
        context: {
          type: "string",
          description:
            "Optional context to include (e.g., file contents, codebase info, marketing guidelines). This will be prefixed to the prompt to give Comet full context.",
        },
        newChat: {
          type: "boolean",
          description: "Start a fresh conversation (default: false)",
        },
        timeout: {
          type: "number",
          description: "Max wait time in ms (default: 120000 = 2min)",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "comet_poll",
    description:
      "Check agent status and progress. Call repeatedly to monitor agentic tasks.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "comet_stop",
    description: "Stop the current agent task if it's going off track",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "comet_screenshot",
    description: "Capture a screenshot of current page",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "comet_tabs",
    description:
      "View and manage browser tabs. Shows all open tabs with their purpose, domain, and status. Helps coordinate multi-tab workflows without creating duplicate tabs.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "switch", "close"],
          description:
            "Action to perform: 'list' (default) shows all tabs, 'switch' activates a tab, 'close' closes a tab",
        },
        domain: {
          type: "string",
          description: "For switch/close: domain to match (e.g., 'github.com')",
        },
        tabId: {
          type: "string",
          description: "For switch/close: specific tab ID",
        },
      },
    },
  },
  COMET_MODE_TOOL,
  {
    name: "comet_upload",
    description:
      "Upload a file to a file input on the current page. Use this to attach images, documents, or other files to forms, posts, or upload dialogs. The file must exist on the local filesystem.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description:
            "Absolute path to the file to upload (e.g., '/home/user/image.png' or 'C:\\Users\\user\\image.png')",
        },
        selector: {
          type: "string",
          description:
            "Optional CSS selector for the file input element. If not provided, auto-detects the first file input on the page.",
        },
        checkOnly: {
          type: "boolean",
          description:
            "If true, only checks if file inputs exist on the page without uploading",
        },
      },
      required: ["filePath"],
    },
  },
];

// The tab choice comet_ask and comet_mode share, and with it the one record
// of the tabs the server opened, whichever of them opened a tab.
const perplexityTab = createCdpPerplexityTab(cometClient);

const modeTool = createCdpModeTool(
  cometClient,
  wrapUntrustedPageContent,
  perplexityTab,
);

// The ask core, and the task comet_poll and comet_stop follow, for as long
// as the server runs. It puts back the mode comet_mode last set.
const askCore = createCdpAskCore({
  client: cometClient,
  comet: cometAI,
  mode: modeTool,
  perplexity: perplexityTab,
  cometPort: DEFAULT_PORT,
});

const server = new Server(
  { name: "comet-bridge", version: SERVER_VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "comet_connect": {
        // Auto-start Comet with debug port (will restart if running without it)
        const startResult = await cometClient.startComet(DEFAULT_PORT);

        // Get all tabs - DON'T clean up tabs, as closing them can crash Comet
        const targets = await cometClient.listTargets();
        const freshTargets = targets; // Use the same list, no cleanup

        // Prefer connecting to the MAIN Perplexity tab (not the sidecar).
        // Comet's right-panel chat helper lives at a sidecar URL that also
        // matches `perplexity.ai` substring — connecting to it routes
        // the prompt and the stop to the wrong tab.
        const perplexityTab =
          freshTargets.find(
            (t) =>
              t.type === "page" &&
              t.url.includes("perplexity.ai") &&
              !t.url.includes("sidecar"),
          ) ||
          freshTargets.find(
            (t) => t.type === "page" && t.url.includes("perplexity.ai"),
          );
        const anyPage =
          perplexityTab || freshTargets.find((t) => t.type === "page");

        if (anyPage) {
          await cometClient.connect(anyPage.id);

          // Only navigate to Perplexity if not already there
          if (!anyPage.url.includes("perplexity.ai")) {
            await cometClient.navigate("https://www.perplexity.ai/", true);
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }

          return {
            content: [
              { type: "text", text: `${startResult}\nConnected to Perplexity` },
            ],
          };
        }

        // No tabs at all - create a new one
        const newTab = await cometClient.newTab("https://www.perplexity.ai/");
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for page load
        await cometClient.connect(newTab.id);
        return {
          content: [
            {
              type: "text",
              text: `${startResult}\nCreated new tab and navigated to Perplexity`,
            },
          ],
        };
      }

      case "comet_ask":
        return toStdioResult(
          describeAskOutcome(await askCore.ask(args), wrapUntrustedPageContent),
        );

      case "comet_poll":
        return toStdioResult(
          describePollOutcome(await askCore.poll(), wrapUntrustedPageContent),
        );

      case "comet_stop":
        return toStdioResult(describeStopOutcome(await askCore.stop()));

      case "comet_screenshot": {
        const result = await cometClient.screenshot("png");
        return {
          content: [
            { type: "image", data: result.data, mimeType: "image/png" },
          ],
        };
      }

      case "comet_tabs": {
        const action = (args?.action as string) || "list";
        const domain = args?.domain as string | undefined;
        const tabId = args?.tabId as string | undefined;

        switch (action) {
          case "list": {
            const summary = await cometClient.getTabSummary();
            return { content: [{ type: "text", text: summary }] };
          }

          case "switch": {
            if (tabId) {
              try {
                validateTabId(tabId);
              } catch (e: any) {
                return {
                  content: [{ type: "text", text: `Error: ${e.message}` }],
                  isError: true,
                };
              }
              await cometClient.connect(tabId);
              return {
                content: [{ type: "text", text: `Switched to tab: ${tabId}` }],
              };
            }
            if (domain) {
              try {
                validateDomain(domain);
              } catch (e: unknown) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Error: ${e instanceof Error ? e.message : String(e)}`,
                    },
                  ],
                  isError: true,
                };
              }
              const tab = await cometClient.findTabByDomain(domain);
              if (tab) {
                await cometClient.connect(tab.id);
                return {
                  content: [
                    {
                      type: "text",
                      text: `Switched to ${tab.domain} (${tab.url})`,
                    },
                  ],
                };
              }
              return {
                content: [
                  {
                    type: "text",
                    text: "No tab found for the specified domain",
                  },
                ],
                isError: true,
              };
            }
            return {
              content: [
                { type: "text", text: "Specify domain or tabId to switch" },
              ],
              isError: true,
            };
          }

          case "close": {
            // Safety check: don't close if it would leave no browsing tabs
            const allTabs = await cometClient.getTabContexts();

            // allTabs now only contains external tabs (Perplexity is filtered as internal)
            if (allTabs.length <= 1) {
              return {
                content: [
                  {
                    type: "text",
                    text: "Cannot close - this is the only browsing tab. Comet needs at least one external tab open.",
                  },
                ],
                isError: true,
              };
            }

            if (tabId) {
              try {
                validateTabId(tabId);
              } catch (e: any) {
                return {
                  content: [{ type: "text", text: `Error: ${e.message}` }],
                  isError: true,
                };
              }
              const success = await cometClient.closeTab(tabId);
              return {
                content: [
                  {
                    type: "text",
                    text: success
                      ? `Closed tab: ${tabId}`
                      : `Failed to close tab`,
                  },
                ],
              };
            }
            if (domain) {
              try {
                validateDomain(domain);
              } catch (e: unknown) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Error: ${e instanceof Error ? e.message : String(e)}`,
                    },
                  ],
                  isError: true,
                };
              }
              const tab = await cometClient.findTabByDomain(domain);
              if (tab && tab.purpose !== "main") {
                const success = await cometClient.closeTab(tab.id);
                return {
                  content: [
                    {
                      type: "text",
                      text: success
                        ? `Closed ${tab.domain}`
                        : `Failed to close tab`,
                    },
                  ],
                };
              }
              if (tab?.purpose === "main") {
                return {
                  content: [
                    { type: "text", text: "Cannot close main Perplexity tab" },
                  ],
                  isError: true,
                };
              }
              return {
                content: [
                  {
                    type: "text",
                    text: "No tab found for the specified domain",
                  },
                ],
                isError: true,
              };
            }
            return {
              content: [
                { type: "text", text: "Specify domain or tabId to close" },
              ],
              isError: true,
            };
          }

          default:
            return {
              content: [
                {
                  type: "text",
                  text: `Unknown action: ${action}. Use: list, switch, close`,
                },
              ],
              isError: true,
            };
        }
      }

      case "comet_mode": {
        return toStdioResult(await answerModeTool(args?.mode, modeTool));
      }

      case "comet_upload": {
        const filePath = args?.filePath as string;
        const selector = args?.selector as string | undefined;
        const checkOnly = args?.checkOnly as boolean | undefined;

        if (!filePath) {
          return {
            content: [{ type: "text", text: "Error: filePath is required" }],
            isError: true,
          };
        }

        // Validate path: enforce COMET_UPLOAD_ROOT allowlist if set, else
        // block well-known secret locations. Resolves symlinks. Throws
        // user-facing message on rejection.
        let resolvedPath: string;
        try {
          resolvedPath = validateUploadPath(filePath);
        } catch (e: any) {
          return {
            content: [{ type: "text", text: `Error: ${e.message}` }],
            isError: true,
          };
        }

        // Defense-in-depth: validate the selector at the tool-handler boundary
        // before it reaches cdp-client.ts (which also validates). Keeps the
        // tool from forwarding obviously-invalid input any further.
        if (selector !== undefined) {
          try {
            validateSelector(selector);
          } catch (e: any) {
            return {
              content: [{ type: "text", text: `Error: ${e.message}` }],
              isError: true,
            };
          }
        }

        // If checkOnly, just report what file inputs exist
        if (checkOnly) {
          const inputInfo = await cometClient.hasFileInput();
          if (inputInfo.found) {
            let msg = `Found ${inputInfo.count} file input(s) on the page:\n`;
            msg += inputInfo.selectors
              .map((s, i) => `  ${i + 1}. ${s}`)
              .join("\n");
            msg += `\n\nUse comet_upload with filePath to upload to one of these inputs.`;
            return { content: [{ type: "text", text: msg }] };
          } else {
            return {
              content: [
                {
                  type: "text",
                  text: "No file input elements found on the current page. Navigate to a page with a file upload form first.",
                },
              ],
            };
          }
        }

        // Perform the upload with the canonical resolved path.
        const result = await cometClient.uploadFile(resolvedPath, selector);

        if (result.success) {
          return { content: [{ type: "text", text: result.message }] };
        } else {
          // If no input found, provide helpful info
          if (!result.inputFound) {
            const inputInfo = await cometClient.hasFileInput();
            let msg = result.message;
            if (inputInfo.found) {
              msg += `\n\nAvailable file inputs:\n${inputInfo.selectors.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}`;
              msg += `\n\nTry specifying a selector parameter.`;
            }
            return { content: [{ type: "text", text: msg }], isError: true };
          }
          return {
            content: [{ type: "text", text: result.message }],
            isError: true,
          };
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : error}`,
        },
      ],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();

// A stdio MCP server's lifetime is its client pipe. When the client disconnects
// (or stdin ends), exit so we don't leak an orphaned, idle process holding a CDP
// connection. Without this, sessions/stalls accumulate zombie processes.
let exiting = false;
const shutdown = (code = 0): void => {
  if (exiting) return; // idempotent: onclose + stdin close may both fire
  exiting = true;
  try {
    transport.close?.();
  } catch {
    // ignore
  }
  process.exit(code);
};
transport.onclose = () => shutdown(0);
transport.onerror = (err: unknown) => {
  console.error(
    "[comet] transport error:",
    err instanceof Error ? err.message : err,
  );
  shutdown(1);
};
// stdin end/close means the client pipe is gone; for a long-lived stdio MCP
// client this is a disconnect, so we exit. (A client that half-closes stdin
// while still reading stdout is not the MCP usage pattern here.)
process.stdin.on("end", () => shutdown(0));
process.stdin.on("close", () => shutdown(0));

// Connect with explicit error handling. The promise was previously
// fire-and-forget — if the transport failed to attach (e.g. stdin
// already closed) the process would silently exit with no logs.
server.connect(transport).catch((err) => {
  console.error("[comet-mcp] Failed to connect MCP transport:", err);
  process.exit(1);
});

// Graceful shutdown: close the CDP client so the underlying WebSocket
// to Comet doesn't sit half-open until Comet times it out. SIGINT
// covers Ctrl+C, SIGTERM covers normal `kill` / orchestrator shutdown.
//
// `disconnect()` is racing a 3s timer so a stuck WebSocket can never
// keep the process alive past Ctrl+C. POSIX exit codes: 128+signum
// (130 = SIGINT, 143 = SIGTERM).
async function gracefulShutdown(signal: string): Promise<void> {
  try {
    await Promise.race([
      cometClient.disconnect(),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]);
  } catch {
    /* best-effort */
  }
  process.exit(signal === "SIGINT" ? 130 : 143);
}
process.on("SIGINT", () => {
  void gracefulShutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void gracefulShutdown("SIGTERM");
});
