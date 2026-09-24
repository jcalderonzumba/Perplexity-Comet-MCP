/**
 * A stand-in MCP server for the battery's integration test: one tool,
 * `comet-port`, that replies with the `COMET_PORT` its process received.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "env-reporting-server",
  version: "1.0.0",
});

server.registerTool(
  "comet-port",
  { description: "The COMET_PORT this process received" },
  async () => ({
    content: [{ type: "text", text: process.env.COMET_PORT ?? "unset" }],
  }),
);

await server.connect(new StdioServerTransport());
