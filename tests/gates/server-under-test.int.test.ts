/**
 * The battery's server parameters, used through the SDK's stdio transport
 * as `tests/run-no-pro.mjs` uses them, reach the spawned server: the port the
 * battery checks is the port the server under test reads.
 */
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";

import { serverUnderTest } from "../lib/server-under-test.mjs";

const STAND_IN = fileURLToPath(
  new URL("./support/env-reporting-server.mjs", import.meta.url),
);

let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
});

async function portTheServerReads(env: Record<string, string>) {
  const server = serverUnderTest(STAND_IN, env);
  client = new Client({ name: "server-under-test", version: "1.0.0" });
  await client.connect(new StdioClientTransport(server.parameters));
  const reply = await client.callTool({ name: "comet-port", arguments: {} });
  const [content] = reply.content as { type: string; text: string }[];
  return { checked: server.port, read: content?.text };
}

describe("the server under test", () => {
  it("reads the COMET_PORT the battery checks", async () => {
    const { checked, read } = await portTheServerReads({ COMET_PORT: "9222" });
    expect(checked).toBe(9222);
    expect(read).toBe("9222");
  });

  it("reads the default port the battery checks when COMET_PORT is unset", async () => {
    const { checked, read } = await portTheServerReads({});
    expect(checked).toBe(9223);
    expect(read).toBe("9223");
  });
});
