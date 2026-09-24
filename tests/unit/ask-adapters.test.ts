// Both adapters' `comet_ask` take the one mode step, `reapplyModeBeforeAsk`,
// after their own navigation and before the prompt is sent, and start every
// result after it with its notice. The adapters start their transport on
// import, so this reads their source; the step itself, its notice and the
// wrapping of page text in it are pinned in `core/ask-mode.test.ts`.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

const MODE_STEP = "const modeNotice = await reapplyModeBeforeAsk(modeTool);";

interface AskAdapter {
  file: string;
  /** Where the adapter's `comet_ask` handler starts and where it ends. */
  from: string;
  to: string;
}

const ADAPTERS: AskAdapter[] = [
  { file: "index.ts", from: 'case "comet_ask": {', to: 'case "comet_poll":' },
  {
    file: "http-bridge.ts",
    from: "async function handleAsk(",
    to: "async function handlePoll(",
  },
];

function askHandlerOf({ file, from, to }: AskAdapter): string {
  const source = readFileSync(join(SRC, file), "utf8");
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  expect(start, `${file}: start of comet_ask`).toBeGreaterThan(-1);
  expect(end, `${file}: end of comet_ask`).toBeGreaterThan(start);
  return source.slice(start, end);
}

/**
 * Each `return { … };` statement in `code`, a result the handler returns.
 * Template literals are dropped first: page script pasted into one returns
 * in the page, not from the handler.
 */
function resultReturns(code: string): string[] {
  const handlerCode = code.replace(/`(?:\\[\s\S]|[^\\`])*`/g, "``");
  return [...handlerCode.matchAll(/\breturn \{[\s\S]*?\n\s*\};/g)].map(
    (m) => m[0],
  );
}

function lastIndexOfAny(code: string, needles: string[]): number {
  return Math.max(...needles.map((needle) => code.lastIndexOf(needle)));
}

describe.each(ADAPTERS)("the $file adapter's comet_ask", (adapter) => {
  const source = readFileSync(join(SRC, adapter.file), "utf8");
  const handler = askHandlerOf(adapter);
  const step = handler.indexOf(MODE_STEP);
  const send = handler.indexOf("cometAI.sendPrompt(");

  it("imports the shared mode step", () => {
    expect(source).toContain(
      'import { reapplyModeBeforeAsk, withModeNotice } from "./core/ask-mode.js";',
    );
  });

  it("takes the mode step once, over its mode tool", () => {
    expect(handler.split(MODE_STEP)).toHaveLength(2);
  });

  it("takes the mode step after its own navigation and reconnects", () => {
    const beforeSend = handler.slice(0, send);
    const lastMove = lastIndexOfAny(beforeSend, [
      ".navigate(",
      ".connect(",
      "startComet(",
    ]);

    expect(lastMove).toBeGreaterThan(-1);
    expect(step).toBeGreaterThan(lastMove);
  });

  it("takes the mode step before the prompt is sent", () => {
    expect(send).toBeGreaterThan(-1);
    expect(step).toBeGreaterThan(-1);
    expect(step).toBeLessThan(send);
  });

  it("starts every result after the mode step with its notice", () => {
    const returns = resultReturns(handler.slice(step));

    expect(returns.length).toBeGreaterThan(0);
    for (const statement of returns) {
      expect(statement).toMatch(/withModeNotice\(\s*modeNotice,/);
    }
  });
});

describe("the http-bridge.ts adapter's comet_ask", () => {
  it("wraps Comet's answer in every result after the prompt is sent, as the stdio server does", () => {
    const handler = askHandlerOf(ADAPTERS[1]);
    const returns = resultReturns(
      handler.slice(handler.indexOf("cometAI.sendPrompt(")),
    );

    expect(returns.length).toBeGreaterThan(0);
    for (const statement of returns) {
      expect(statement).toContain("wrapUntrustedPageContent(");
    }
  });
});
