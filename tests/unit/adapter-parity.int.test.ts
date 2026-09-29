// Both adapters over one table: the same call comes out with the same words
// in each transport's shape. The stdio server is driven over the SDK's
// in-memory transport and the bridge over a loopback port the test picks.

import type http from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBridgeServer } from "../../src/bridge-server.js";
import {
  type CdpToolsClient,
  createCdpToolTable,
} from "../../src/cdp-tools.js";
import { TOOL_DEFINITIONS, type ToolTable } from "../../src/core/tools.js";
import { createStdioServer } from "../../src/stdio-server.js";
import { scriptedTable } from "./fakes/scripted-tool-table.js";

const TOKEN = "parity-token";
const open: http.Server[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    open
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

/** What a client sees of one call, in either transport. */
type Seen =
  | { kind: "text"; text: string; failed: boolean }
  | { kind: "image"; data: string; mimeType: string };

interface Transports {
  stdio(name: string, args: Record<string, unknown>): Promise<Seen>;
  bridge(name: string, args: Record<string, unknown>): Promise<Seen>;
  bridgeStatus(name: string, args: Record<string, unknown>): Promise<number>;
}

async function transportsOver(table: ToolTable): Promise<Transports> {
  const stdioServer = createStdioServer(table, "1.0.0");
  const client = new Client({ name: "parity", version: "1.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await stdioServer.connect(serverSide);
  await client.connect(clientSide);

  const bridgeServer = createBridgeServer({
    table,
    token: TOKEN,
    corsOrigin: null,
    version: "1.0.0",
  });
  open.push(bridgeServer);
  await new Promise<void>((resolve) =>
    bridgeServer.listen(0, "127.0.0.1", resolve),
  );
  const { port } = bridgeServer.address() as AddressInfo;

  const post = (name: string, args: Record<string, unknown>) =>
    fetch(`http://127.0.0.1:${port}/tool/${name}`, {
      method: "POST",
      headers: { Authorization: TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });

  return {
    async stdio(name, args) {
      const result = (await client.callTool({ name, arguments: args })) as {
        content: {
          type: string;
          text?: string;
          data?: string;
          mimeType?: string;
        }[];
        isError?: boolean;
      };
      const block = result.content[0];
      return block.type === "image"
        ? {
            kind: "image",
            data: block.data ?? "",
            mimeType: block.mimeType ?? "",
          }
        : {
            kind: "text",
            text: block.text ?? "",
            failed: result.isError === true,
          };
    },
    async bridge(name, args) {
      const body = (await (await post(name, args)).json()) as {
        success: boolean;
        content: string | { type: string; data: string; mimeType: string }[];
        error?: string;
      };
      if (typeof body.content !== "string") {
        const [image] = body.content;
        return { kind: "image", data: image.data, mimeType: image.mimeType };
      }
      return body.success
        ? { kind: "text", text: body.content, failed: false }
        : { kind: "text", text: body.error ?? "", failed: true };
    },
    async bridgeStatus(name, args) {
      return (await post(name, args)).status;
    },
  };
}

const TOOL_NAMES = TOOL_DEFINITIONS.map((tool) => tool.name);

describe("one scripted table through both adapters", () => {
  it.each(TOOL_NAMES)("%s: a text reply comes out the same", async (name) => {
    const t = await transportsOver(scriptedTable().table);

    expect(await t.bridge(name, {})).toEqual(await t.stdio(name, {}));
    expect(await t.stdio(name, {})).toEqual({
      kind: "text",
      text: `${name} answered`,
      failed: false,
    });
  });

  it.each(TOOL_NAMES)("%s: an error reply comes out the same", async (name) => {
    const t = await transportsOver(scriptedTable().table);
    const args = { reply: "error" };

    expect(await t.bridge(name, args)).toEqual(await t.stdio(name, args));
    expect(await t.stdio(name, args)).toEqual({
      kind: "text",
      text: `${name} refused`,
      failed: true,
    });
    expect(await t.bridgeStatus(name, args)).toBe(400);
  });

  it.each(TOOL_NAMES)(
    "%s: a handler that throws comes out the same",
    async (name) => {
      const t = await transportsOver(scriptedTable().table);
      const args = { reply: "throw" };

      expect(await t.bridge(name, args)).toEqual(await t.stdio(name, args));
      expect(await t.stdio(name, args)).toEqual({
        kind: "text",
        text: `Error: ${name} broke`,
        failed: true,
      });
    },
  );

  it("comet_screenshot: an image reply comes out as an image in each shape", async () => {
    const t = await transportsOver(scriptedTable().table);
    const args = { reply: "image" };

    expect(await t.bridge("comet_screenshot", args)).toEqual(
      await t.stdio("comet_screenshot", args),
    );
    expect(await t.stdio("comet_screenshot", args)).toEqual({
      kind: "image",
      data: "cG5n",
      mimeType: "image/png",
    });
    expect(await t.bridgeStatus("comet_screenshot", args)).toBe(200);
  });

  it("an unknown tool is an error in both, with the same words", async () => {
    const t = await transportsOver(scriptedTable().table);

    expect(await t.bridge("comet_click", {})).toEqual(
      await t.stdio("comet_click", {}),
    );
    expect(await t.stdio("comet_click", {})).toEqual({
      kind: "text",
      text: "Error: Unknown tool: comet_click",
      failed: true,
    });
    expect(await t.bridgeStatus("comet_click", {})).toBe(400);
  });
});

describe("the real composition through both adapters, on a client that answers nothing", () => {
  function realTable(): ToolTable {
    const client = new Proxy(
      {},
      {
        get: () => () => Promise.reject(new Error("the browser was reached")),
      },
    ) as CdpToolsClient;
    return createCdpToolTable({
      client,
      comet: { getAgentStatus: vi.fn() },
      quotePage: (text) => text,
      port: 9222,
    });
  }

  it.each([
    ["a missing filePath", "comet_upload", {}, "Error: filePath is required"],
    [
      "an unknown tabs action",
      "comet_tabs",
      { action: "open" },
      "Unknown action: open. Use: list, switch, close",
    ],
    [
      "an invalid tab id",
      "comet_tabs",
      { action: "switch", tabId: "nope" },
      "Error: Invalid tabId format: nope",
    ],
    ["an unknown tool", "comet_click", {}, "Error: Unknown tool: comet_click"],
  ])(
    "%s: the same words in each shape, the browser untouched",
    async (_case, name, args, words) => {
      const t = await transportsOver(realTable());

      const viaStdio = await t.stdio(name, args);
      const viaBridge = await t.bridge(name, args);

      expect(viaStdio).toEqual({ kind: "text", text: words, failed: true });
      expect(viaBridge).toEqual(viaStdio);
      expect(await t.bridgeStatus(name, args)).toBe(400);
    },
  );
});
