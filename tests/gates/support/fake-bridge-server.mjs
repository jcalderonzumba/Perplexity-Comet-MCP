/**
 * A stand-in for a pinned build of the server, for `npm run bridge:update`'s
 * integration test: it declares the tools named in `FAKE_BRIDGE_TOOLS`
 * (comma-separated), and nothing else.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "comet-bridge", version: "0.0.0" });

for (const tool of (process.env.FAKE_BRIDGE_TOOLS ?? "").split(",")) {
  if (tool === "") continue;
  server.registerTool(tool, { description: `stand-in ${tool}` }, async () => ({
    content: [{ type: "text", text: tool }],
  }));
}

await server.connect(new StdioServerTransport());
