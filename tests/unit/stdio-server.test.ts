// The stdio adapter over a fake table: it lists the table's definitions and
// answers a call through the table, in MCP's result shape. Driven over the
// SDK's in-memory transport, so no process is started.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { TOOL_DEFINITIONS } from "../../src/core/tools.js";
import { createStdioServer } from "../../src/stdio-server.js";
import { scriptedTable } from "./fakes/scripted-tool-table.js";

async function clientOver(table = scriptedTable()) {
  const server = createStdioServer(table.table, "9.9.9");
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  await client.connect(clientSide);
  return { client, ...table };
}

describe("the stdio adapter", () => {
  it("reports the version it was given in the handshake", async () => {
    const { client } = await clientOver();

    expect(client.getServerVersion()).toMatchObject({
      name: "comet-bridge",
      version: "9.9.9",
    });
  });

  it("lists the table's definitions, in order", async () => {
    const { client } = await clientOver();

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(
      TOOL_DEFINITIONS.map((tool) => tool.name),
    );
    expect(tools[1]?.inputSchema).toEqual(TOOL_DEFINITIONS[1]?.inputSchema);
  });

  it("answers a call through the table with the call's arguments", async () => {
    const { client, calls } = await clientOver();

    const result = await client.callTool({
      name: "comet_ask",
      arguments: { prompt: "hi" },
    });

    expect(calls).toEqual([{ name: "comet_ask", args: { prompt: "hi" } }]);
    expect(result).toEqual({
      content: [{ type: "text", text: "comet_ask answered" }],
    });
  });

  it("flags an error reply, and shows an image as an image block", async () => {
    const { client } = await clientOver();

    const failed = await client.callTool({
      name: "comet_poll",
      arguments: { reply: "error" },
    });
    const shot = await client.callTool({
      name: "comet_screenshot",
      arguments: { reply: "image" },
    });

    expect(failed).toEqual({
      content: [{ type: "text", text: "comet_poll refused" }],
      isError: true,
    });
    expect(shot).toEqual({
      content: [{ type: "image", data: "cG5n", mimeType: "image/png" }],
    });
  });

  it("answers a thrown handler and an unknown tool as error results", async () => {
    const { client } = await clientOver();

    const thrown = await client.callTool({
      name: "comet_stop",
      arguments: { reply: "throw" },
    });
    const unknown = await client.callTool({ name: "comet_click" });

    expect(thrown).toMatchObject({
      content: [{ text: "Error: comet_stop broke" }],
      isError: true,
    });
    expect(unknown).toMatchObject({
      content: [{ text: "Error: Unknown tool: comet_click" }],
      isError: true,
    });
  });
});
