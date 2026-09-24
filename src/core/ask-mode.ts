// The mode step of `comet_ask`, for every adapter alike: after the ask's own
// navigation and before it types the prompt, the page is put back in the
// mode `comet_mode` last set, since Perplexity resets it to Search on every
// navigation. When that fails the ask still goes on, and its result starts
// with a line saying so, so an answer is never silently in the wrong mode.

import { describeModeFailure } from "./mode.js";
import type { ModeTool } from "./mode-tool.js";

/** What the mode step leaves for the ask's result: a line, or nothing. */
export interface ModeNotice {
  readonly line: string | null;
}

const NO_NOTICE: ModeNotice = { line: null };

/**
 * Re-applies the remembered mode, when there is one and the page has lost
 * it. Never throws: a failure becomes the notice's line, with page text
 * passed through the tool's `quotePage`.
 */
export async function reapplyModeBeforeAsk(
  tool: Pick<ModeTool, "core" | "quotePage">,
): Promise<ModeNotice> {
  const outcome = await tool.core.ensureMode();
  if (outcome.status !== "failed") return NO_NOTICE;
  const reason = describeModeFailure(outcome.failure, tool.quotePage);
  return {
    line: `Mode not applied: this answer may not be in ${outcome.mode} mode. ${reason}`,
  };
}

/** The ask's result text, started with the notice's line when there is one. */
export function withModeNotice(notice: ModeNotice, resultText: string): string {
  return notice.line === null ? resultText : `${notice.line}\n\n${resultText}`;
}
