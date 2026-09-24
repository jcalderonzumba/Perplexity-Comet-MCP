import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

import { callWithin } from "../lib/call-within.mjs";
import type { ToolReply } from "../lib/no-pro-checks.mjs";

type CallToolArgs = Parameters<Client["callTool"]>;

/** A client whose `callTool` records its arguments and settles as told. */
function fakeClient(settle: () => Promise<ToolReply>) {
  const calls: CallToolArgs[] = [];
  const client = {
    callTool: (...args: CallToolArgs) => {
      calls.push(args);
      return settle();
    },
  } as unknown as Client;
  return { client, calls };
}

const REPLY: ToolReply = { content: [{ type: "text", text: "done" }] };

describe("callWithin", () => {
  it("calls the tool with its arguments", async () => {
    const { client, calls } = fakeClient(async () => REPLY);

    await callWithin(client)("comet_mode", { mode: "research" }, 20000);

    expect(calls[0]?.[0]).toEqual({
      name: "comet_mode",
      arguments: { mode: "research" },
    });
  });

  it("gives the SDK the call's limit, so a call past 60 s is not cut at the SDK's default", async () => {
    const { client, calls } = fakeClient(async () => REPLY);

    await callWithin(client)("comet_ask", { prompt: "p" }, 200000);

    expect(calls[0]?.[2]).toMatchObject({ timeout: 200000 });
  });

  it("resolves with the tool's reply", async () => {
    const { client } = fakeClient(async () => REPLY);

    await expect(callWithin(client)("comet_tabs", {}, 10000)).resolves.toBe(
      REPLY,
    );
  });

  it("rejects with TIMEOUT after the limit when the SDK's request times out", async () => {
    const { client } = fakeClient(async () => {
      throw new McpError(ErrorCode.RequestTimeout, "Request timed out", {
        timeout: 10000,
      });
    });

    await expect(
      callWithin(client)("comet_ask", { prompt: "p" }, 10000),
    ).rejects.toThrow(/^TIMEOUT after 10000ms$/);
  });

  it("rejects with any other error as it came", async () => {
    const crash = new McpError(ErrorCode.ConnectionClosed, "Connection closed");
    const { client } = fakeClient(async () => {
      throw crash;
    });

    await expect(callWithin(client)("comet_tabs", {}, 10000)).rejects.toBe(
      crash,
    );
  });
});
