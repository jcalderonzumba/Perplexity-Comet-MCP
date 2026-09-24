/**
 * How both live batteries call a tool on the server under test: each call
 * has its own limit, and the MCP SDK enforces it. Without a limit of its own
 * the SDK stops every request at its 60 s default, whatever the battery
 * allows the call.
 */

import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

/** @typedef {import("@modelcontextprotocol/sdk/client/index.js").Client} Client */
/** @typedef {import("./no-pro-checks.mjs").CallTool} CallTool */
/** @typedef {import("./no-pro-checks.mjs").ToolReply} ToolReply */

/**
 * The SDK gave up on the request at its limit.
 * @param {unknown} error
 */
function timedOut(error) {
  return error instanceof McpError && error.code === ErrorCode.RequestTimeout;
}

/**
 * Calls a tool within `timeoutMs`; a call past it rejects with
 * `TIMEOUT after <timeoutMs>ms`, and any other failure as it came.
 * @param {Client} client
 * @returns {CallTool}
 */
export function callWithin(client) {
  return async (name, args, timeoutMs) => {
    try {
      const reply = await client.callTool(
        { name, arguments: args },
        undefined,
        { timeout: timeoutMs },
      );
      // The SDK's type also admits the legacy `{ toolResult }` reply, which
      // this server never sends: its tools answer with `content`.
      return /** @type {ToolReply} */ (reply);
    } catch (error) {
      if (timedOut(error)) throw new Error(`TIMEOUT after ${timeoutMs}ms`);
      throw error;
    }
  };
}
