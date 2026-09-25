// A tool's reply in each transport's shape: the stdio server's MCP result
// and the HTTP bridge's JSON result. The words come from the tool core; an
// adapter only puts them in its shape, through these.

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** A tool's reply, as a core words it. */
export interface ToolReply {
  readonly text: string;
  readonly isError: boolean;
}

/** The HTTP bridge's result for a tool call. */
export interface BridgeToolResult {
  success: boolean;
  content: string | { type: string; data?: string; mimeType?: string }[];
  error?: string;
}

/** The reply as an MCP tool result: one text block, flagged when an error. */
export function toStdioResult(reply: ToolReply): CallToolResult {
  return {
    content: [{ type: "text", text: reply.text }],
    ...(reply.isError ? { isError: true } : {}),
  };
}

/** The reply as the bridge's result: its text in `error` when an error. */
export function toBridgeResult(reply: ToolReply): BridgeToolResult {
  return reply.isError
    ? { success: false, content: "", error: reply.text }
    : { success: true, content: reply.text };
}
