/**
 * `.claude/settings.json` wires the two PreToolUse hooks to the commands they
 * judge, and each hook it names is an executable file in the repository.
 */
import { accessSync, constants, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot } from "./support/git-sandbox.ts";

type HookEntry = { type: string; if?: string; command: string };
type Settings = {
  hooks: { PreToolUse: { matcher: string; hooks: HookEntry[] }[] };
  enabledMcpjsonServers?: string[];
};

const settings = JSON.parse(
  readFileSync(join(repoRoot, ".claude", "settings.json"), "utf8"),
) as Settings;
const bashHooks = settings.hooks.PreToolUse.filter(
  (entry) => entry.matcher === "Bash",
).flatMap((entry) => entry.hooks);

describe(".claude/settings.json", () => {
  it.each([
    ["protect-main.sh", "Bash(git *)"],
    ["pr-gate.sh", "Bash(gh *)"],
  ])("runs %s on %s", (script, condition) => {
    const entry = bashHooks.find((hook) =>
      hook.command.endsWith(`/.claude/hooks/${script}`),
    );
    expect(entry).toMatchObject({ type: "command", if: condition });
  });

  it("names only hooks that exist and are executable", () => {
    for (const hook of bashHooks) {
      const script = hook.command.replace(/^"\$CLAUDE_PROJECT_DIR"\//, "");
      expect(() =>
        accessSync(join(repoRoot, script), constants.X_OK),
      ).not.toThrow();
    }
  });

  it("enables the CodeGraph server from .mcp.json", () => {
    expect(settings.enabledMcpjsonServers).toEqual(["codegraph"]);
    const mcp = JSON.parse(
      readFileSync(join(repoRoot, ".mcp.json"), "utf8"),
    ) as {
      mcpServers: Record<string, unknown>;
    };
    expect(Object.keys(mcp.mcpServers)).toEqual(["codegraph"]);
  });
});
