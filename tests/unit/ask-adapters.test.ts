// Both adapters' `comet_ask`, `comet_poll` and `comet_stop` are translations
// over the one ask core: the arguments in, one call into the core, and its
// outcome out in the transport's shape, with page text wrapped by the shared
// UNTRUSTED wrapper. The adapters start their transport on import, so this
// reads their source. The ask, the poll and the stop themselves (validation,
// shaping, the tab, the mode step after the navigation and before sending,
// the completion rules, the timeout, the task) are pinned in
// `core/ask.test.ts`, the port in `cdp-ask-port.test.ts`, and each adapter's
// rendering in `tool-results.test.ts`.

import { existsSync, readdirSync, readFileSync } from "node:fs";
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

  it("builds its ask core once, over the CDP client, with its mode tool, the tab choice they share and the configured port", () => {
    const builds = source.match(/createCdpAskCore\(\{[^}]*\}\)/g) ?? [];

    expect(builds).toHaveLength(1);
    expect(builds[0]).toMatch(/client:\s*cometClient\b/);
    expect(builds[0]).toMatch(/comet:\s*cometAI\b/);
    expect(builds[0]).toMatch(/mode:\s*modeTool\b/);
    expect(builds[0]).toMatch(/perplexity:\s*perplexityTab\b/);
    expect(builds[0]).toMatch(/cometPort:\s*DEFAULT_PORT\b/);
    expect(source).toMatch(
      /import \{[^}]*\bDEFAULT_PORT\b[^}]*\} from "\.\/cdp-client\.js";/,
    );
  });

  it("pastes no prose-state script", () => {
    expect(source).not.toContain('[class*="prose"]');
    expect(source).not.toContain("readProseState");
  });

  it("keeps no task state of its own, and leaves the core's to the core", () => {
    expect(source).not.toMatch(
      /session-state\.js|\bsessionState\b|\bSessionState\b|\bAskTaskState\b|\bstartNewTask\b|\bcompleteTask\b|\bisSessionStale\b|\bgenerateTaskId\b|\bcurrentTaskId\b/,
    );
    expect(source).not.toMatch(/askCore\.task\b/);
  });
});

interface TaskTool {
  tool: "comet_poll" | "comet_stop";
  /** The core's method, and the function that words its outcome. */
  call: string;
  describe: string;
  /** Whether the wording quotes page text through the adapter's wrapper. */
  quotesPage: boolean;
}

const TASK_TOOLS: TaskTool[] = [
  {
    tool: "comet_poll",
    call: "askCore.poll()",
    describe: "describePollOutcome",
    quotesPage: true,
  },
  {
    tool: "comet_stop",
    call: "askCore.stop()",
    describe: "describeStopOutcome",
    quotesPage: false,
  },
];

/** Where each adapter's handler of `tool` starts and ends. */
const TASK_HANDLERS: Record<
  string,
  Record<TaskTool["tool"], [string, string]>
> = {
  "index.ts": {
    comet_poll: ['case "comet_poll":', 'case "comet_stop":'],
    comet_stop: ['case "comet_stop":', 'case "comet_screenshot":'],
  },
  "http-bridge.ts": {
    comet_poll: ["async function handlePoll(", "async function handleStop("],
    comet_stop: [
      "async function handleStop(",
      "async function handleScreenshot(",
    ],
  },
};

/** What only a poll or stop of its own would hold: page reads and task state. */
const TASK_OF_ITS_OWN = [
  "getAgentStatus",
  "stopAgent",
  "ensureOnPerplexityTab",
  "evaluate(",
  "askCore.task",
  "isActive",
  "lastResponse",
  "Status:",
];

describe.each(
  ADAPTERS.flatMap((adapter) => TASK_TOOLS.map((tool) => ({ adapter, tool }))),
)("the $adapter.file adapter's $tool.tool", ({ adapter, tool }) => {
  const [from, to] = TASK_HANDLERS[adapter.file][tool.tool];
  const handler = askHandlerOf({ ...adapter, from, to });

  it("makes one call into the ask core and words its outcome through the core, in its transport's shape", () => {
    const quoted = tool.quotesPage ? ",\\s*wrapUntrustedPageContent,?" : ",?";
    expect(handler.match(/askCore\./g)).toHaveLength(1);
    expect(handler).toMatch(
      new RegExp(
        `${adapter.shape}\\(\\s*${tool.describe}\\(\\s*await ${escapeRegExp(tool.call)}${quoted}\\s*\\),?\\s*\\)`,
      ),
    );
  });

  it("reads no page and keeps no task state of its own", () => {
    for (const needle of TASK_OF_ITS_OWN) {
      expect(handler, needle).not.toContain(needle);
    }
  });
});

describe("the task state", () => {
  it("is created by the ask core alone, so both adapters follow its task", () => {
    const creators = readdirSync(SRC, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts"))
      .filter((file) => /new AskTaskState\(/.test(sourceOf(file)));

    expect(creators).toEqual([join("core", "ask.ts")]);
  });

  it("has no module-level copy left behind", () => {
    expect(existsSync(join(SRC, "session-state.ts"))).toBe(false);
  });
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
