/**
 * The battery's server parameters, used through the SDK's stdio transport
 * as `tests/run-no-pro.mjs` uses them, reach the spawned server: the port the
 * battery checks is the port the server under test reads. And the battery's
 * debug-port probe, asked against a loopback listener the test opens, answers
 * as the server's own check does.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";

import { debugPort, serverUnderTest } from "../lib/server-under-test.mjs";

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

/**
 * A listener on 127.0.0.1 that answers `status` and records each URL asked,
 * as its `Host` header and path.
 */
async function loopbackListener(status: number) {
  const asked: string[] = [];
  const listener: Server = createServer((request, response) => {
    asked.push(`${request.headers.host}${request.url}`);
    response.writeHead(status, { "content-type": "application/json" });
    response.end("{}");
  });
  await new Promise<void>((listening) =>
    listener.listen(0, "127.0.0.1", listening),
  );
  const { port } = listener.address() as AddressInfo;
  const close = () =>
    new Promise<void>((closed) => {
      listener.closeAllConnections();
      listener.close(() => closed());
    });
  return { port, asked, close };
}

/** A loopback port nothing listens on: one the system gave out, then freed. */
async function portNothingListensOn() {
  const listener = await loopbackListener(200);
  await listener.close();
  return listener.port;
}

describe("the debug-port probe", () => {
  it("answers true when 127.0.0.1 answers 200 on /json/version", async () => {
    const listener = await loopbackListener(200);
    try {
      expect(await debugPort(listener.port).answers()).toBe(true);
      expect(listener.asked).toEqual([
        `127.0.0.1:${listener.port}/json/version`,
      ]);
    } finally {
      await listener.close();
    }
  });

  it("answers false when 127.0.0.1 answers 404", async () => {
    const listener = await loopbackListener(404);
    try {
      expect(await debugPort(listener.port).answers()).toBe(false);
    } finally {
      await listener.close();
    }
  });

  it("answers false when nothing listens on the port", async () => {
    const port = await portNothingListensOn();
    expect(await debugPort(port).answers()).toBe(false);
  });
});
