// A tool's reply in each transport's shape: the stdio server's MCP result
// and the HTTP bridge's JSON result. The words come from the tool core; an
// adapter only puts them in its shape, through these.

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolReply } from "./core/tool-reply.js";

/** The HTTP bridge's result for a tool call. */
export interface BridgeToolResult {
  success: boolean;
  content: string | { type: string; data?: string; mimeType?: string }[];
  error?: string;
}

/**
 * The reply as an MCP tool result: one text block, flagged when an error, or
 * one image block.
 */
export function toStdioResult(reply: ToolReply): CallToolResult {
  switch (reply.kind) {
    case "text":
      return {
        content: [{ type: "text", text: reply.text }],
        ...(reply.isError ? { isError: true } : {}),
      };
    case "image":
      return {
        content: [
          { type: "image", data: reply.data, mimeType: reply.mimeType },
        ],
      };
  }
}

/**
 * The reply as the bridge's result: its text in `error` when an error, an
 * image as a content array.
 */
export function toBridgeResult(reply: ToolReply): BridgeToolResult {
  switch (reply.kind) {
    case "text":
      return reply.isError
        ? { success: false, content: "", error: reply.text }
        : { success: true, content: reply.text };
    case "image":
      return {
        success: true,
        content: [
          { type: "image", data: reply.data, mimeType: reply.mimeType },
        ],
      };
  }
}
