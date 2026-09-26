// Both adapters answer `comet_mode` through the one mode tool, with the one
// UNTRUSTED wrapper. The adapters start their transport on import, so this
// reads their source; the behaviour itself, forged markers included, is
// pinned in `core/mode-tool.test.ts` and `cdp-mode-page.test.ts`.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

function sourceOf(file: string): string {
  return readFileSync(join(SRC, file), "utf8");
}

function sourceFiles(directory = SRC): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(directory, entry.name))
      : [join(directory, entry.name)],
  );
}

describe.each(["index.ts", "http-bridge.ts"])("the %s adapter", (file) => {
  const source = sourceOf(file);

  it("builds its mode tool over the CDP client with the shared UNTRUSTED wrapper and the shared tab choice", () => {
    expect(source).toContain(
      'import { wrapUntrustedPageContent } from "./untrusted.js";',
    );
    expect(source).toMatch(
      /createCdpModeTool\(\s*cometClient,\s*wrapUntrustedPageContent,\s*perplexityTab,?\s*\)/,
    );
  });

  it("builds one tab choice over the CDP client, for its mode tool and its ask core alike", () => {
    const builds = source.match(/createCdpPerplexityTab\([^)]*\)/g) ?? [];

    expect(builds).toEqual(["createCdpPerplexityTab(cometClient)"]);
    expect(source).toMatch(
      /const perplexityTab = createCdpPerplexityTab\(cometClient\);/,
    );
    expect(source).not.toMatch(/new PerplexityTab\b/);
  });

  it("answers comet_mode through the mode tool", () => {
    expect(source).toMatch(/answerModeTool\([^)]*modeTool\)/);
  });

  it("pastes no mode script of its own", () => {
    expect(source).not.toMatch(/modeMap|dropdownBtn|Mode selector not found/);
  });
});

describe("src/", () => {
  it("holds none of the old mode selectors", () => {
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain('aria-label="Research"');
      expect(source, file).not.toContain('button[class*="gap"]');
    }
  });
});
