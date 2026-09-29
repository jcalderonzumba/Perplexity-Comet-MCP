// What the design keeps true of the sources as a whole. The adapters and the
// composition are read as text because starting them starts a transport or a
// browser connection; their behaviour is pinned in `stdio-server.test.ts`,
// `bridge-server.int.test.ts`, `adapter-parity.int.test.ts` and
// `cdp-tools.test.ts`.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ADAPTER_FILES } from "./support/adapter-files.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

function sourceOf(file: string): string {
  return readFileSync(join(SRC, file), "utf8");
}

function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" }).filter(
    (file) => file.endsWith(".ts"),
  );
}

describe.each([...ADAPTER_FILES, "cdp-tools.ts"])("%s", (file) => {
  const source = sourceOf(file);

  it("pastes no prose-state or mode script of its own", () => {
    expect(source).not.toContain('[class*="prose"]');
    expect(source).not.toContain("readProseState");
    expect(source).not.toMatch(/modeMap|dropdownBtn|Mode selector not found/);
  });

  it("keeps no task state of its own, and leaves the core's to the core", () => {
    expect(source).not.toMatch(
      /session-state\.js|\bsessionState\b|\bSessionState\b|\bAskTaskState\b|\bstartNewTask\b|\bcompleteTask\b|\bisSessionStale\b|\bgenerateTaskId\b|\bcurrentTaskId\b/,
    );
    expect(source).not.toMatch(/askCore\.task\b/);
  });

  it("writes no inline copy of the error-message idiom", () => {
    expect(source).not.toMatch(/instanceof Error \?/);
  });
});

describe("the task state", () => {
  it("is created by the ask core alone, so both adapters follow its task", () => {
    const creators = sourceFiles().filter((file) =>
      /new AskTaskState\(/.test(sourceOf(file)),
    );

    expect(creators).toEqual([join("core", "ask.ts")]);
  });

  it("has no module-level copy left behind", () => {
    expect(existsSync(join(SRC, "session-state.ts"))).toBe(false);
  });
});

describe("src/", () => {
  it("holds none of the old mode selectors", () => {
    for (const file of sourceFiles()) {
      const source = sourceOf(file);
      expect(source, file).not.toContain('aria-label="Research"');
      expect(source, file).not.toContain('button[class*="gap"]');
    }
  });
});
