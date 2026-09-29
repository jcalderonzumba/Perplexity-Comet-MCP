#!/usr/bin/env node

// Comet Browser MCP Server
// Claude Code ↔ Perplexity Comet bidirectional interaction
//
// This file starts the stdio transport: the server itself is
// `stdio-server.ts`, and every tool is answered by the table `cdp-tools.ts`
// builds, the same table the HTTP bridge answers from.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createCdpTools } from "./cdp-tools.js";
import { errorMessage } from "./error-message.js";
import { packageVersion } from "./package-version.js";
import { createStdioServer } from "./stdio-server.js";

const tools = createCdpTools();
const server = createStdioServer(tools.table, packageVersion());

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
  console.error("[comet] transport error:", errorMessage(err));
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
      tools.disconnect(),
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
