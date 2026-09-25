#!/usr/bin/env node

/**
 * HTTP Bridge Server for Remote MCP Access
 *
 * Enables remote clients (e.g., n8n on Linux) to connect to a Comet instance
 * running on Windows/macOS over HTTP.
 *
 * Usage:
 *   COMET_BRIDGE_TOKEN=your-secret-token node dist/http-bridge.js
 *
 * Environment variables:
 *   - COMET_BRIDGE_TOKEN:       Required. Authentication token for API access.
 *   - COMET_BRIDGE_PORT:        Optional. Port to listen on (default: 3210).
 *   - COMET_BRIDGE_HOST:        Optional. Host to bind to (default: 0.0.0.0).
 *   - COMET_BRIDGE_CORS_ORIGIN: Optional. Allowed CORS origin. Omit to disable
 *                               CORS headers (recommended for server-to-server
 *                               use). Set to a specific origin (e.g.,
 *                               "https://n8n.example.com") for browser clients.
 *                               Never set to "*" in production.
 */

import { timingSafeEqual } from "crypto";
import http from "http";
import { URL } from "url";
import { createCdpAskCore } from "./cdp-ask-port.js";
import { cometClient, DEFAULT_PORT } from "./cdp-client.js";
import { createCdpModeTool } from "./cdp-mode-page.js";
import { cometAI } from "./comet-ai.js";
import { describeAskOutcome } from "./core/ask-reply.js";
import { answerModeTool } from "./core/mode-tool.js";
import {
  type BridgeToolResult as ToolResult,
  toBridgeResult,
} from "./tool-results.js";
import { wrapUntrustedPageContent } from "./untrusted.js";
import {
  validateDomain,
  validateSelector,
  validateTabId,
  validateUploadPath,
} from "./upload-validator.js";

// ============================================================================
// Configuration
// ============================================================================

const BRIDGE_TOKEN = process.env.COMET_BRIDGE_TOKEN;
const BRIDGE_PORT = parseInt(process.env.COMET_BRIDGE_PORT || "3210", 10);
const BRIDGE_HOST = process.env.COMET_BRIDGE_HOST || "0.0.0.0";

/**
 * CORS origin to include in responses, or null to omit CORS headers.
 *
 * Wildcard CORS ("*") is intentionally not supported: the bridge uses
 * bearer-token authentication, and "Access-Control-Allow-Origin: *" would
 * let any origin trigger credentialed cross-site requests in a browser.
 * Set COMET_BRIDGE_CORS_ORIGIN to a specific trusted origin when a browser-
 * based client needs access.
 */
const CORS_ORIGIN = process.env.COMET_BRIDGE_CORS_ORIGIN ?? null;

if (!BRIDGE_TOKEN) {
  console.error("ERROR: COMET_BRIDGE_TOKEN environment variable is required");
  console.error(
    "Usage: COMET_BRIDGE_TOKEN=your-secret-token node dist/http-bridge.js",
  );
  process.exit(1);
}

// ============================================================================
// Tool Handlers (extracted from index.ts for reuse)
// ============================================================================

// The mode tool, and the mode it remembers, shared by comet_mode and
// comet_ask for as long as the bridge runs.
const modeTool = createCdpModeTool(cometClient, wrapUntrustedPageContent);

// The ask core, and the task comet_poll and comet_stop follow, for as long
// as the bridge runs. It puts back the mode comet_mode last set, and starts
// Comet on the configured debug port when the connection is lost.
const askCore = createCdpAskCore({
  client: cometClient,
  comet: cometAI,
  mode: modeTool,
  cometPort: DEFAULT_PORT,
});

async function handleConnect(): Promise<ToolResult> {
  const startResult = await cometClient.startComet(9223);
  const targets = await cometClient.listTargets();
  const perplexityTab = targets.find(
    (t) => t.type === "page" && t.url.includes("perplexity.ai"),
  );
  const anyPage = perplexityTab || targets.find((t) => t.type === "page");

  if (anyPage) {
    await cometClient.connect(anyPage.id);
    if (!anyPage.url.includes("perplexity.ai")) {
      await cometClient.navigate("https://www.perplexity.ai/", true);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return {
      success: true,
      content: `${startResult}\nConnected to Perplexity`,
    };
  }

  const newTab = await cometClient.newTab("https://www.perplexity.ai/");
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await cometClient.connect(newTab.id);
  return {
    success: true,
    content: `${startResult}\nCreated new tab and navigated to Perplexity`,
  };
}

async function handleAsk(args: Record<string, unknown>): Promise<ToolResult> {
  return toBridgeResult(
    describeAskOutcome(await askCore.ask(args), wrapUntrustedPageContent),
  );
}

async function handlePoll(): Promise<ToolResult> {
  if (askCore.task.isStale()) {
    return {
      success: true,
      content: "No active task (session stale or not started)",
    };
  }

  const status = await cometAI.getAgentStatus();
  const allSteps = [...new Set([...askCore.task.steps, ...status.steps])];

  let output = "";
  if (askCore.task.isActive) {
    output = `Status: working\nPrompt: ${askCore.task.lastPrompt || "unknown"}\n`;
    if (status.response) {
      output += `\nPartial response:\n${status.response.substring(0, 500)}${status.response.length > 500 ? "..." : ""}`;
    }
  } else {
    output = `Status: complete\nResponse:\n${askCore.task.lastResponse || "No response"}`;
  }

  if (allSteps.length > 0) {
    output += `\nSteps:\n${allSteps.map((s) => `  • ${s}`).join("\n")}\n`;
  }
  if (status.status === "working" || askCore.task.isActive) {
    output += `\n[Use comet_stop to interrupt, or comet_screenshot to see current page]`;
  }

  return { success: true, content: output };
}

async function handleStop(): Promise<ToolResult> {
  const stopped = await cometAI.stopAgent();
  if (stopped) {
    askCore.task.isActive = false;
  }
  return {
    success: true,
    content: stopped ? "Agent stopped" : "No active agent to stop",
  };
}

async function handleScreenshot(): Promise<ToolResult> {
  const result = await cometClient.screenshot("png");
  return {
    success: true,
    content: [{ type: "image", data: result.data, mimeType: "image/png" }],
  };
}

async function handleTabs(args: {
  action?: string;
  domain?: string;
  tabId?: string;
}): Promise<ToolResult> {
  const action = args.action || "list";
  const domain = args.domain;
  const rawTabId = args.tabId;

  switch (action) {
    case "list": {
      const summary = await cometClient.getTabSummary();
      return { success: true, content: summary };
    }

    case "switch": {
      if (rawTabId) {
        // Validate tabId before passing to CDP.
        try {
          const tabId = validateTabId(rawTabId);
          await cometClient.connect(tabId);
          return { success: true, content: `Switched to tab: ${tabId}` };
        } catch (err: unknown) {
          return {
            success: false,
            content: "",
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
      if (domain) {
        try {
          validateDomain(domain);
        } catch (err: unknown) {
          return {
            success: false,
            content: "",
            error: err instanceof Error ? err.message : String(err),
          };
        }
        const tab = await cometClient.findTabByDomain(domain);
        if (tab) {
          await cometClient.connect(tab.id);
          return {
            success: true,
            content: `Switched to ${tab.domain} (${tab.url})`,
          };
        }
        return {
          success: false,
          content: "",
          error: "No tab found for the specified domain",
        };
      }
      return {
        success: false,
        content: "",
        error: "Specify domain or tabId to switch",
      };
    }

    case "close": {
      const allTabs = await cometClient.getTabContexts();
      if (allTabs.length <= 1) {
        return {
          success: false,
          content: "",
          error: "Cannot close - this is the only browsing tab",
        };
      }

      if (rawTabId) {
        // Validate tabId before passing to CDP.
        try {
          const tabId = validateTabId(rawTabId);
          const success = await cometClient.closeTab(tabId);
          return {
            success,
            content: success ? `Closed tab: ${tabId}` : "Failed to close tab",
          };
        } catch (err: unknown) {
          return {
            success: false,
            content: "",
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
      if (domain) {
        try {
          validateDomain(domain);
        } catch (err: unknown) {
          return {
            success: false,
            content: "",
            error: err instanceof Error ? err.message : String(err),
          };
        }
        const tab = await cometClient.findTabByDomain(domain);
        if (tab && tab.purpose !== "main") {
          const success = await cometClient.closeTab(tab.id);
          return {
            success,
            content: success ? `Closed ${tab.domain}` : "Failed to close tab",
          };
        }
        if (tab?.purpose === "main") {
          return {
            success: false,
            content: "",
            error: "Cannot close main Perplexity tab",
          };
        }
        return {
          success: false,
          content: "",
          error: "No tab found for the specified domain",
        };
      }
      return {
        success: false,
        content: "",
        error: "Specify domain or tabId to close",
      };
    }

    default:
      return {
        success: false,
        content: "",
        error: `Unknown action: ${action}. Use: list, switch, close`,
      };
  }
}

async function handleUpload(args: {
  filePath?: string;
  selector?: string;
  checkOnly?: boolean;
}): Promise<ToolResult> {
  const filePath = args.filePath;
  if (!filePath) {
    return { success: false, content: "", error: "filePath is required" };
  }

  // Validate path before any DOM interaction.
  let resolvedPath: string;
  try {
    resolvedPath = validateUploadPath(filePath);
  } catch (err: unknown) {
    return {
      success: false,
      content: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (args.checkOnly) {
    const inputInfo = await cometClient.hasFileInput();
    if (inputInfo.found) {
      let msg = `Found ${inputInfo.count} file input(s) on the page:\n`;
      msg += inputInfo.selectors
        .map((s: string, i: number) => `  ${i + 1}. ${s}`)
        .join("\n");
      msg += `\n\nUse comet_upload with filePath to upload to one of these inputs.`;
      return { success: true, content: msg };
    } else {
      return {
        success: true,
        content: "No file input elements found on the current page.",
      };
    }
  }

  // Defense-in-depth: validate the selector at the handler boundary
  // before it reaches cdp-client.ts (which also validates). Keeps the
  // HTTP bridge from forwarding obviously-invalid input any further.
  if (args.selector !== undefined) {
    try {
      validateSelector(args.selector);
    } catch (e: any) {
      return { success: false, content: "", error: e.message };
    }
  }

  const result = await cometClient.uploadFile(resolvedPath, args.selector);
  return {
    success: result.success,
    content: result.message,
    error: result.success ? undefined : result.message,
  };
}

async function handleMode(args: { mode?: unknown }): Promise<ToolResult> {
  return toBridgeResult(await answerModeTool(args.mode, modeTool));
}

// ============================================================================
// HTTP Server
// ============================================================================

/**
 * Build CORS headers for a response.
 *
 * Returns an empty object when COMET_BRIDGE_CORS_ORIGIN is not set (server-
 * to-server callers don't need CORS headers). Returns origin-specific headers
 * when the env var is set to a specific origin.
 *
 * Wildcard ("*") is never emitted — the bridge uses bearer-token auth and
 * wildcard CORS is unsafe in that combination.
 */
function corsHeaders(): Record<string, string> {
  if (!CORS_ORIGIN) return {};
  return {
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function sendJSON(
  res: http.ServerResponse,
  statusCode: number,
  data: unknown,
): void {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    ...corsHeaders(),
  });
  res.end(JSON.stringify(data));
}

function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

/**
 * Validate the bearer token using a timing-safe comparison.
 *
 * String equality (`===`) leaks the length of the matching prefix via
 * timing differences — replaced with `crypto.timingSafeEqual`, which
 * always takes the same time regardless of where strings diverge.
 *
 * Equal-length buffers are required by timingSafeEqual. If lengths differ
 * we know immediately that the tokens don't match, but we still run the
 * comparison on a zero-length buffer to avoid the timing difference caused
 * by a short-circuit branch.
 */
function validateToken(req: http.IncomingMessage): boolean {
  const authHeader = req.headers.authorization;
  if (!authHeader) return false;

  // Support both "Bearer <token>" and just "<token>"
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(BRIDGE_TOKEN!);

  if (tokenBuf.byteLength !== expectedBuf.byteLength) {
    // Lengths differ — tokens cannot match, but still run a dummy comparison
    // so the branch doesn't produce a measurable timing difference for
    // tokens of the correct length.
    timingSafeEqual(Buffer.alloc(1), Buffer.alloc(1));
    return false;
  }

  return timingSafeEqual(tokenBuf, expectedBuf);
}

const server = http.createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...corsHeaders(),
    });
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const path = url.pathname;

  // Health check endpoint (no auth required)
  if (path === "/health" && req.method === "GET") {
    sendJSON(res, 200, {
      status: "ok",
      version: "2.7.0",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // API info endpoint (no auth required)
  if (path === "/" && req.method === "GET") {
    sendJSON(res, 200, {
      name: "comet-bridge",
      version: "2.7.0",
      description: "HTTP Bridge for Remote Comet MCP Access",
      endpoints: {
        "GET /health": "Health check",
        "GET /tools": "List available tools",
        "POST /tool/:name": "Execute a tool",
        "POST /rpc": "JSON-RPC style endpoint",
      },
    });
    return;
  }

  // All other endpoints require authentication
  if (!validateToken(req)) {
    sendJSON(res, 401, {
      error: "Unauthorized",
      message: "Invalid or missing token",
    });
    return;
  }

  try {
    // List tools
    if (path === "/tools" && req.method === "GET") {
      sendJSON(res, 200, {
        tools: [
          { name: "comet_connect", description: "Connect to Comet browser" },
          { name: "comet_ask", description: "Send a prompt and get response" },
          { name: "comet_poll", description: "Check agent status" },
          { name: "comet_stop", description: "Stop current task" },
          { name: "comet_screenshot", description: "Capture screenshot" },
          { name: "comet_tabs", description: "Manage browser tabs" },
          { name: "comet_mode", description: "Switch Perplexity mode" },
          {
            name: "comet_upload",
            description: "Upload a file to a file input on the current page",
          },
        ],
      });
      return;
    }

    // Execute tool via /tool/:name
    const toolMatch = path.match(/^\/tool\/(\w+)$/);
    if (toolMatch && req.method === "POST") {
      const toolName = toolMatch[1];
      const args = (await parseBody(req)) as Record<string, unknown>;
      const result = await executeToolByName(toolName, args);
      sendJSON(res, result.success ? 200 : 400, result);
      return;
    }

    // JSON-RPC style endpoint
    if (path === "/rpc" && req.method === "POST") {
      const body = (await parseBody(req)) as {
        method?: string;
        params?: Record<string, unknown>;
      };
      if (!body.method) {
        sendJSON(res, 400, {
          error: "Bad Request",
          message: "Missing 'method' field",
        });
        return;
      }
      const result = await executeToolByName(body.method, body.params || {});
      sendJSON(res, result.success ? 200 : 400, result);
      return;
    }

    // 404 for unknown routes
    sendJSON(res, 404, {
      error: "Not Found",
      message: `Unknown endpoint: ${path}`,
    });
  } catch (error) {
    console.error("Server error:", error);
    sendJSON(res, 500, {
      error: "Internal Server Error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

async function executeToolByName(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  switch (name) {
    case "comet_connect":
      return handleConnect();
    case "comet_ask":
      return handleAsk(args);
    case "comet_poll":
      return handlePoll();
    case "comet_stop":
      return handleStop();
    case "comet_screenshot":
      return handleScreenshot();
    case "comet_tabs":
      return handleTabs(
        args as { action?: string; domain?: string; tabId?: string },
      );
    case "comet_mode":
      return handleMode(args);
    case "comet_upload":
      return handleUpload(
        args as { filePath?: string; selector?: string; checkOnly?: boolean },
      );
    default:
      return { success: false, content: "", error: `Unknown tool: ${name}` };
  }
}

// ============================================================================
// Start Server
// ============================================================================

server.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           Comet MCP HTTP Bridge Server v2.7.0                 ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  Status:    RUNNING                                           ║
║  Host:      ${BRIDGE_HOST.padEnd(45)}║
║  Port:      ${String(BRIDGE_PORT).padEnd(45)}║
║  Auth:      Token-based (Authorization header)                ║
║  CORS:      ${(CORS_ORIGIN ?? "disabled").padEnd(45)}║
║                                                               ║
║  Endpoints:                                                   ║
║    GET  /health     - Health check (no auth)                  ║
║    GET  /tools      - List available tools                    ║
║    POST /tool/:name - Execute a tool                          ║
║    POST /rpc        - JSON-RPC style calls                    ║
║                                                               ║
║  Example:                                                     ║
║    curl -X POST http://localhost:${String(BRIDGE_PORT).padEnd(24)}║
║         -H "Authorization: Bearer YOUR_TOKEN"                 ║
║         -H "Content-Type: application/json"                   ║
║         -d '{"method":"comet_connect"}'                       ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down HTTP bridge...");
  server.close(() => {
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  console.log("\nReceived SIGTERM, shutting down...");
  server.close(() => {
    process.exit(0);
  });
});
