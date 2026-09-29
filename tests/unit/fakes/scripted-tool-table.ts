// A real tool table whose handlers answer as the call says, so a test can
// drive an adapter without a browser: `{ reply: "text" | "error" | "image" |
// "throw" }` picks what a tool gives back, and every call is recorded.

import {
  errorReply,
  imageReply,
  textReply,
} from "../../../src/core/tool-reply.js";
import {
  createToolTable,
  TOOL_DEFINITIONS,
  type ToolHandlers,
  type ToolTable,
} from "../../../src/core/tools.js";

export interface ScriptedCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

export interface ScriptedTable {
  readonly table: ToolTable;
  readonly calls: ScriptedCall[];
}

export function scriptedTable(): ScriptedTable {
  const calls: ScriptedCall[] = [];
  const handlers: ToolHandlers = Object.fromEntries(
    TOOL_DEFINITIONS.map(({ name }) => [
      name,
      async (args: Record<string, unknown>) => {
        calls.push({ name, args });
        switch (args.reply) {
          case "error":
            return errorReply(`${name} refused`);
          case "image":
            return imageReply("cG5n", "image/png");
          case "throw":
            throw new Error(`${name} broke`);
          default:
            return textReply(`${name} answered`);
        }
      },
    ]),
  );
  return { table: createToolTable(handlers, (text) => `<<${text}>>`), calls };
}
