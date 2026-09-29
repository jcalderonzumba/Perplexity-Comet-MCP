// The stdio adapter's server: it lists the tool table's definitions and
// answers a call through the table, in MCP's result shape. It holds no tool
// logic and no transport; `index.ts` starts it on stdin and stdout.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ToolTable } from "./core/tools.js";
import { toStdioResult } from "./tool-results.js";

/** The MCP server over `table`, reporting `version` in the handshake. */
export function createStdioServer(table: ToolTable, version: string): Server {
  const server = new Server(
    { name: "comet-bridge", version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...table.definitions],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    toStdioResult(
      await table.call(request.params.name, request.params.arguments),
    ),
  );

  return server;
}
