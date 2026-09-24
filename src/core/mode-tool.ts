// The `comet_mode` tool over the mode core, for every adapter alike: its
// definition, and its argument in and its reply out. An adapter only puts
// the reply in its transport's shape.
//
// Text read from the page reaches the reply only through `quotePage`, the
// adapter's UNTRUSTED wrapper.

import {
  isToolMode,
  MODE_CATALOGUE,
  type ModeEntry,
  TOOL_MODES,
  type ToolMode,
} from "../modes.js";
import {
  describeModeFailure,
  type ModeCore,
  type ModeReading,
} from "./mode.js";

/** The tool's definition, as MCP lists it. Its input schema is the contract. */
export const COMET_MODE_TOOL = {
  name: "comet_mode",
  description:
    "Switch Perplexity's mode, or call without mode to read the current one from the page. 'search' is Search and 'research' is Deep research; 'labs' and 'learn' are not available and fail with the reason.",
  inputSchema: {
    type: "object" as const,
    properties: {
      mode: {
        type: "string",
        enum: [...TOOL_MODES],
        description: "Mode to switch to (optional - omit to see current mode)",
      },
    },
  },
};

/** What the tool needs; each adapter builds one when it starts. */
export interface ModeTool {
  readonly core: ModeCore;
  /** Brings the tab to Perplexity before a switch touches the page. */
  readonly openPerplexity: () => Promise<void>;
  /** Wraps a text read from the page as untrusted. */
  readonly quotePage: (pageText: string) => string;
}

export interface ModeToolReply {
  readonly text: string;
  readonly isError: boolean;
}

/**
 * Answers `comet_mode`: an absent or empty `mode` reads the current mode,
 * any other switches to it.
 */
export async function answerModeTool(
  mode: unknown,
  tool: ModeTool,
): Promise<ModeToolReply> {
  if (!mode) {
    const reading = await tool.core.readMode();
    return { text: describeReading(reading, tool.quotePage), isError: false };
  }
  if (touchesThePage(mode)) await tool.openPerplexity();
  const result = await tool.core.switchMode(mode);
  return result.ok
    ? { text: `Switched to ${result.mode} mode`, isError: false }
    : {
        text: describeModeFailure(result.failure, tool.quotePage),
        isError: true,
      };
}

/** Whether switching to `mode` goes to the page, rather than being refused. */
function touchesThePage(mode: unknown): boolean {
  return isToolMode(mode) && MODE_CATALOGUE[mode].selectable;
}

function describeReading(
  reading: ModeReading,
  quotePage: (pageText: string) => string,
): string {
  const current = reading.kind === "known" ? reading.mode : undefined;
  return [
    `Current mode: ${currentModeText(reading, quotePage)}`,
    "",
    "Available modes:",
    ...TOOL_MODES.map((mode) => modeLine(mode, mode === current)),
    "",
  ].join("\n");
}

function currentModeText(
  reading: ModeReading,
  quotePage: (pageText: string) => string,
): string {
  switch (reading.kind) {
    case "known":
      return reading.mode;
    case "unknown":
      return `unknown (the mode button reads ${quotePage(reading.text)})`;
    case "no-button":
      return "unknown (no mode button found on the page)";
  }
}

function modeLine(mode: ToolMode, isCurrent: boolean): string {
  return `${isCurrent ? "→" : " "} ${mode}: ${entryText(MODE_CATALOGUE[mode])}`;
}

function entryText(entry: ModeEntry): string {
  return entry.selectable ? entry.pageLabel : `not available (${entry.reason})`;
}
