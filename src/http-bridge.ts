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
 *
 * This file reads the environment and starts the server; the routes are in
 * `bridge-server.ts` and every tool is answered by the table `cdp-tools.ts`
 * builds, the same table the stdio server answers from.
 */

import {
  type BridgeConfig,
  createBridgeServer,
  readBridgeConfig,
} from "./bridge-server.js";
import { createCdpTools } from "./cdp-tools.js";
import { errorMessage } from "./error-message.js";
import { packageVersion } from "./package-version.js";

function configFromEnvironment(): BridgeConfig {
  try {
    return readBridgeConfig(process.env);
  } catch (error) {
    console.error(`ERROR: ${errorMessage(error)}`);
    console.error(
      "Usage: COMET_BRIDGE_TOKEN=your-secret-token node dist/http-bridge.js",
    );
    process.exit(1);
  }
}

const config = configFromEnvironment();
const version = packageVersion();

const server = createBridgeServer({
  table: createCdpTools().table,
  token: config.token,
  corsOrigin: config.corsOrigin,
  version,
});

server.listen(config.port, config.host, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           Comet MCP HTTP Bridge Server v${version.padEnd(22)}║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  Status:    RUNNING                                           ║
║  Host:      ${config.host.padEnd(45)}║
║  Port:      ${String(config.port).padEnd(45)}║
║  Auth:      Token-based (Authorization header)                ║
║  CORS:      ${(config.corsOrigin ?? "disabled").padEnd(45)}║
║                                                               ║
║  Endpoints:                                                   ║
║    GET  /health     - Health check (no auth)                  ║
║    GET  /tools      - List available tools                    ║
║    POST /tool/:name - Execute a tool                          ║
║    POST /rpc        - JSON-RPC style calls                    ║
║                                                               ║
║  Example:                                                     ║
║    curl -X POST http://localhost:${String(config.port).padEnd(24)}║
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
