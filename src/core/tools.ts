// The tool table: what every tool is, declared once, and the one dispatch
// both adapters answer a call through. A tool's definition is what MCP lists
// (name, description, input schema); its handler takes the call's arguments
// and returns a `ToolReply`. The composition (`src/cdp-tools.ts`) supplies
// the handlers; the adapters only list the definitions and put replies in
// their transport's shape.
//
// A handler that throws becomes an error reply worded by `errorMessage`. A
// page script's detail is text the page chooses, so it reaches a reply only
// through the wrapper the table is built with.

import { errorMessage } from "../error-message.js";
import { COMET_MODE_TOOL } from "./mode-tool.js";
import { PageScriptFailed } from "./page-script-failed.js";
import { errorReply, type ToolReply } from "./tool-reply.js";

/** A tool as MCP lists it. Its input schema is the contract (principle 8). */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: "object";
    readonly properties?: Readonly<Record<string, unknown>>;
    readonly required?: readonly string[];
  };
}

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: "comet_connect",
    description: "Connect to Comet browser (auto-starts if needed)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "comet_ask",
    description:
      "Send a prompt to Comet/Perplexity and wait for the complete response (blocking). Ideal for tasks requiring real browser interaction (login walls, dynamic content, filling forms) or deep research with agentic browsing.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "Question or task for Comet - focus on goals and context",
        },
        context: {
          type: "string",
          description:
            "Optional context to include (e.g., file contents, codebase info, marketing guidelines). This will be prefixed to the prompt to give Comet full context.",
        },
        newChat: {
          type: "boolean",
          description: "Start a fresh conversation (default: false)",
        },
        timeout: {
          type: "number",
          description: "Max wait time in ms (default: 120000 = 2min)",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "comet_poll",
    description:
      "Check agent status and progress. Call repeatedly to monitor agentic tasks.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "comet_stop",
    description: "Stop the current agent task if it's going off track",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "comet_screenshot",
    description: "Capture a screenshot of current page",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "comet_tabs",
    description:
      "View and manage browser tabs. Shows all open tabs with their purpose, domain, and status. Helps coordinate multi-tab workflows without creating duplicate tabs.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "switch", "close"],
          description:
            "Action to perform: 'list' (default) shows all tabs, 'switch' activates a tab, 'close' closes a tab",
        },
        domain: {
          type: "string",
          description: "For switch/close: domain to match (e.g., 'github.com')",
        },
        tabId: {
          type: "string",
          description: "For switch/close: specific tab ID",
        },
      },
    },
  },
  COMET_MODE_TOOL,
  {
    name: "comet_upload",
    description:
      "Upload a file to a file input on the current page. Use this to attach images, documents, or other files to forms, posts, or upload dialogs. The file must exist on the local filesystem.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description:
            "Absolute path to the file to upload (e.g., '/home/user/image.png' or 'C:\\Users\\user\\image.png')",
        },
        selector: {
          type: "string",
          description:
            "Optional CSS selector for the file input element. If not provided, auto-detects the first file input on the page.",
        },
        checkOnly: {
          type: "boolean",
          description:
            "If true, only checks if file inputs exist on the page without uploading",
        },
      },
      required: ["filePath"],
    },
  },
];

/** Answers one call of a tool: its arguments in, its reply out. */
export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolReply>;

/** A handler for each tool of `TOOL_DEFINITIONS`, by name. */
export type ToolHandlers = Readonly<Record<string, ToolHandler>>;

/** The tools, listed and answered. */
export interface ToolTable {
  /** Every tool's definition, in the order MCP lists them. */
  readonly definitions: readonly ToolDefinition[];
  /** Answers a call by tool name; never throws. */
  call(
    name: string,
    args: Record<string, unknown> | undefined,
  ): Promise<ToolReply>;
}

/**
 * The table over `handlers`, which must answer every defined tool and no
 * other. `quotePage` is the UNTRUSTED wrapper: the only way text the page
 * chose reaches a reply the table words.
 */
export function createToolTable(
  handlers: ToolHandlers,
  quotePage: (pageText: string) => string,
): ToolTable {
  const entries = entriesOf(handlers);
  return {
    definitions: TOOL_DEFINITIONS,
    async call(name, args) {
      const handler = entries.get(name);
      if (!handler) return errorReply(`Error: Unknown tool: ${name}`);
      try {
        return await handler(args ?? {});
      } catch (error) {
        return errorReply(failureText(error, quotePage));
      }
    },
  };
}

function entriesOf(handlers: ToolHandlers): Map<string, ToolHandler> {
  const defined = TOOL_DEFINITIONS.map((tool) => tool.name);
  const missing = defined.filter((name) => !Object.hasOwn(handlers, name));
  const extra = Object.keys(handlers).filter((name) => !defined.includes(name));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `The tool table needs a handler for each defined tool and no other: missing ${missing.join(", ") || "none"}, unknown ${extra.join(", ") || "none"}`,
    );
  }
  return new Map(Object.entries(handlers));
}

/** `Error: ` and the message, then the page's part quoted when there is one. */
function failureText(
  error: unknown,
  quotePage: (pageText: string) => string,
): string {
  const line = `Error: ${errorMessage(error)}`;
  return error instanceof PageScriptFailed
    ? `${line}: ${quotePage(error.pageDetail)}`
    : line;
}
