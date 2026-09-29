// The HTTP bridge adapter's server: bearer-token authentication, CORS and
// the routes, over the tool table. It holds no tool logic: `/tool/:name` and
// `/rpc` answer through the table and put its reply in the bridge's shape,
// `/tools` lists the table's definitions. `http-bridge.ts` reads the
// environment and starts it.

import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { ToolTable } from "./core/tools.js";
import { errorMessage } from "./error-message.js";
import { toBridgeResult } from "./tool-results.js";

/** What the bridge reads from the environment. */
export interface BridgeConfig {
  readonly token: string;
  readonly port: number;
  readonly host: string;
  /**
   * CORS origin to include in responses, or null to omit CORS headers.
   *
   * Wildcard CORS ("*") is intentionally not supported: the bridge uses
   * bearer-token authentication, and "Access-Control-Allow-Origin: *" would
   * let any origin trigger credentialed cross-site requests in a browser.
   * Set COMET_BRIDGE_CORS_ORIGIN to a specific trusted origin when a
   * browser-based client needs access.
   */
  readonly corsOrigin: string | null;
}

export const MISSING_TOKEN_MESSAGE =
  "COMET_BRIDGE_TOKEN environment variable is required";

/** The bridge's settings from `env`; throws when there is no token. */
export function readBridgeConfig(
  env: Readonly<Record<string, string | undefined>>,
): BridgeConfig {
  if (!env.COMET_BRIDGE_TOKEN) throw new Error(MISSING_TOKEN_MESSAGE);
  return {
    token: env.COMET_BRIDGE_TOKEN,
    port: parseInt(env.COMET_BRIDGE_PORT || "3210", 10),
    host: env.COMET_BRIDGE_HOST || "0.0.0.0",
    corsOrigin: env.COMET_BRIDGE_CORS_ORIGIN ?? null,
  };
}

export interface BridgeServerOptions {
  readonly table: ToolTable;
  readonly token: string;
  readonly corsOrigin: string | null;
  /** Reported on `/health` and `/`. */
  readonly version: string;
}

/** The HTTP server over `options.table`, not yet listening. */
export function createBridgeServer(options: BridgeServerOptions): http.Server {
  const { table, token, corsOrigin, version } = options;

  /**
   * CORS headers for a response: empty when no origin is configured
   * (server-to-server callers don't need them), the configured origin
   * otherwise. A wildcard is never emitted.
   */
  function corsHeaders(): Record<string, string> {
    if (!corsOrigin) return {};
    return {
      "Access-Control-Allow-Origin": corsOrigin,
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

  async function runTool(
    res: http.ServerResponse,
    name: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    const result = toBridgeResult(await table.call(name, args));
    sendJSON(res, result.success ? 200 : 400, result);
  }

  return http.createServer(async (req, res) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, { ...corsHeaders() });
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const path = url.pathname;

    // Health check endpoint (no auth required)
    if (path === "/health" && req.method === "GET") {
      sendJSON(res, 200, {
        status: "ok",
        version,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // API info endpoint (no auth required)
    if (path === "/" && req.method === "GET") {
      sendJSON(res, 200, {
        name: "comet-bridge",
        version,
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
    if (!tokenMatches(req, token)) {
      sendJSON(res, 401, {
        error: "Unauthorized",
        message: "Invalid or missing token",
      });
      return;
    }

    try {
      // List tools
      if (path === "/tools" && req.method === "GET") {
        sendJSON(res, 200, { tools: table.definitions });
        return;
      }

      // Execute tool via /tool/:name
      const toolMatch = path.match(/^\/tool\/(\w+)$/);
      if (toolMatch && req.method === "POST") {
        const args = (await parseBody(req)) as Record<string, unknown>;
        await runTool(res, toolMatch[1], args);
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
        await runTool(res, body.method, body.params || {});
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
        message: errorMessage(error),
      });
    }
  });
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
 * Whether the request carries the bearer token, compared with a timing-safe
 * comparison.
 *
 * String equality (`===`) leaks the length of the matching prefix via
 * timing differences; `crypto.timingSafeEqual` always takes the same time
 * regardless of where strings diverge.
 *
 * Equal-length buffers are required by timingSafeEqual. If lengths differ
 * we know immediately that the tokens don't match, but we still run a dummy
 * comparison to avoid the timing difference caused by a short-circuit branch.
 */
function tokenMatches(req: http.IncomingMessage, expected: string): boolean {
  const authHeader = req.headers.authorization;
  if (!authHeader) return false;

  // Support both "Bearer <token>" and just "<token>"
  const supplied = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);

  if (suppliedBuf.byteLength !== expectedBuf.byteLength) {
    timingSafeEqual(Buffer.alloc(1), Buffer.alloc(1));
    return false;
  }

  return timingSafeEqual(suppliedBuf, expectedBuf);
}
