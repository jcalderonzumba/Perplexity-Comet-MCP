// Both adapters' `comet_ask` are translations over the one ask core: the
// arguments in, one call into the core, and its outcome out in the
// transport's shape, with page text wrapped by the shared UNTRUSTED wrapper.
// The adapters start their transport on import, so this reads their source.
// The ask itself (validation, shaping, the tab, the mode step after the
// navigation and before sending, the completion rules, the timeout) is
// pinned in `core/ask.test.ts`, the port in `cdp-ask-port.test.ts`, and each
// adapter's rendering in `tool-results.test.ts`.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

interface AskAdapter {
  file: string;
  /** Where the adapter's `comet_ask` handler starts and where it ends. */
  from: string;
  to: string;
  /** The function that puts a reply in the adapter's transport shape. */
  shape: string;
}

const ADAPTERS: AskAdapter[] = [
  {
    file: "index.ts",
    from: 'case "comet_ask":',
    to: 'case "comet_poll":',
    shape: "toStdioResult",
  },
  {
    file: "http-bridge.ts",
    from: "async function handleAsk(",
    to: "async function handlePoll(",
    shape: "toBridgeResult",
  },
];

function sourceOf(file: string): string {
  return readFileSync(join(SRC, file), "utf8");
}

function askHandlerOf({ file, from, to }: AskAdapter): string {
  const source = sourceOf(file);
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  expect(start, `${file}: start of comet_ask`).toBeGreaterThan(-1);
  expect(end, `${file}: end of comet_ask`).toBeGreaterThan(start);
  return source.slice(start, end);
}

/** What only an ask of its own would hold: sending, reading, waiting, shaping. */
const ASK_OF_ITS_OWN = [
  "sendPrompt",
  "getAgentStatus",
  "evaluate(",
  "readProseState",
  "isStable",
  "hasStopButton",
  "setTimeout",
  ".replace(",
  "navigate(",
  "startComet",
  "preOperationCheck",
];

describe.each(ADAPTERS)("the $file adapter's comet_ask", (adapter) => {
  const source = sourceOf(adapter.file);
  const handler = askHandlerOf(adapter);

  it("makes one call into the ask core, with the tool's arguments", () => {
    expect(handler.match(/askCore\.ask\(/g)).toHaveLength(1);
    expect(handler).toMatch(/askCore\.ask\(args\)/);
  });

  it("words the outcome through the core, wrapping page text with the shared wrapper, in its transport's shape", () => {
    expect(handler).toMatch(
      new RegExp(
        `${adapter.shape}\\(\\s*describeAskOutcome\\(\\s*await askCore\\.ask\\(args\\),\\s*wrapUntrustedPageContent,?\\s*\\),?\\s*\\)`,
      ),
    );
    expect(source).toContain(
      'import { wrapUntrustedPageContent } from "./untrusted.js";',
    );
  });

  it("holds no completion rule, prompt shaping, page script or recovery of its own", () => {
    for (const needle of ASK_OF_ITS_OWN) {
      expect(handler, needle).not.toContain(needle);
    }
  });

  it("builds its ask core once, over the CDP client, with its mode tool and the configured port", () => {
    const builds = source.match(/createCdpAskCore\(\{[^}]*\}\)/g) ?? [];

    expect(builds).toHaveLength(1);
    expect(builds[0]).toMatch(/client:\s*cometClient\b/);
    expect(builds[0]).toMatch(/comet:\s*cometAI\b/);
    expect(builds[0]).toMatch(/mode:\s*modeTool\b/);
    expect(builds[0]).toMatch(/cometPort:\s*DEFAULT_PORT\b/);
    expect(source).toMatch(
      /import \{[^}]*\bDEFAULT_PORT\b[^}]*\} from "\.\/cdp-client\.js";/,
    );
  });

  it("pastes no prose-state script", () => {
    expect(source).not.toContain('[class*="prose"]');
    expect(source).not.toContain("readProseState");
  });

  it("follows the task the ask core keeps, not one of its own", () => {
    expect(source).not.toMatch(/session-state\.js|\bstartNewTask\(/);
    expect(source).toMatch(/askCore\.task\b/);
  });
});
