/**
 * A throwaway home directory and stand-in `git`, `npx` and `claude` for
 * `npm run bridge:update`'s integration test. `git` answers the remote and the
 * tip of `main`; `npx` starts a fake build declaring the tools a test chooses;
 * `claude` only records how it was called. Each stand-in logs its call, so a
 * test sees what the script ran, and nothing touches the real configuration.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { BRIDGE_TOOLS } from "../../../scripts/lib/bridge.mjs";
import { type Outcome, repoRoot, runProcess } from "./git-sandbox.ts";

export const REMOTE = "git@github.com:owner/repo.git";
export const MAIN_TIP = "b".repeat(40);

const SCRIPT = join(repoRoot, "scripts", "update-bridge.mjs");
const FAKE_BUILD = join(
  repoRoot,
  "tests",
  "gates",
  "support",
  "fake-bridge-server.mjs",
);

export class BridgeSandbox {
  readonly #root = mkdtempSync(join(tmpdir(), "comet-bridge-update-"));
  readonly home = join(this.#root, "home");
  readonly #bin = join(this.#root, "bin");
  readonly #log = join(this.#root, "commands.log");
  #tools: readonly string[] = BRIDGE_TOOLS;
  #claudeFailsOn: string | null = null;

  constructor() {
    mkdirSync(this.home);
    mkdirSync(this.#bin);
    this.standIn(
      "git",
      `echo "git $*" >> '${this.#log}'\n` +
        `case "$*" in\n` +
        `  "remote get-url origin") echo '${REMOTE}' ;;\n` +
        `  "ls-remote origin refs/heads/main") printf '${MAIN_TIP}\\trefs/heads/main\\n' ;;\n` +
        `  *) exit 2 ;;\n` +
        `esac`,
    );
    this.buildStarts();
  }

  /** Writes `~/.claude.json` with this user-scope `comet-bridge` entry, or none. */
  configure(entry: object | null, home = this.home): void {
    const servers = entry === null ? {} : { "comet-bridge": entry };
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: servers, projects: {} }),
    );
  }

  /** Writes `~/.claude.json` with this exact text. */
  writeConfig(text: string): void {
    writeFileSync(join(this.home, ".claude.json"), text);
  }

  /** A second directory, for `CLAUDE_CONFIG_DIR`. */
  configDirectory(): string {
    const directory = join(this.#root, "config");
    mkdirSync(directory);
    return directory;
  }

  /** The fake build declares only these tools. */
  offerTools(tools: readonly string[]): void {
    this.#tools = tools;
  }

  /** `npx` fails before the build ever answers. */
  buildFails(): void {
    this.standIn("npx", `echo "npx $*" >> '${this.#log}'\nexit 1`);
  }

  /** `claude` exits 1 when its arguments contain `text`. */
  claudeFailsOn(text: string): void {
    this.#claudeFailsOn = text;
  }

  update(args: readonly string[] = [], env: NodeJS.ProcessEnv = {}): Outcome {
    this.#writeClaude();
    return runProcess("node", [SCRIPT, ...args], {
      cwd: this.#root,
      env: {
        HOME: this.home,
        PATH: `${this.#bin}${delimiter}${process.env.PATH}`,
        FAKE_BRIDGE_TOOLS: this.#tools.join(","),
        ...env,
      },
      // The machine's own settings never leak in; a test sets what it needs.
      unsetEnv: ["CLAUDE_CONFIG_DIR", "COMET_PORT"].filter(
        (name) => !(name in env),
      ),
    });
  }

  /** Every stand-in call, in order, as `<tool> <arguments>`. */
  commandsRun(): string[] {
    if (!existsSync(this.#log)) return [];
    return readFileSync(this.#log, "utf8").trimEnd().split("\n");
  }

  /** The calls one stand-in received, its name left off. */
  callsTo(tool: "git" | "npx" | "claude"): string[] {
    return this.commandsRun()
      .filter((line) => line.startsWith(`${tool} `))
      .map((line) => line.slice(tool.length + 1));
  }

  remove(): void {
    rmSync(this.#root, { recursive: true, force: true });
  }

  buildStarts(): void {
    this.standIn(
      "npx",
      `echo "npx $* COMET_PORT=$COMET_PORT" >> '${this.#log}'\n` +
        `exec node '${FAKE_BUILD}'`,
    );
  }

  #writeClaude(): void {
    const failure =
      this.#claudeFailsOn === null
        ? ""
        : `case "$*" in *'${this.#claudeFailsOn}'*) exit 1 ;; esac\n`;
    this.standIn(
      "claude",
      `echo "claude $*" >> '${this.#log}'\n${failure}exit 0`,
    );
  }

  standIn(tool: string, body: string): void {
    const file = join(this.#bin, tool);
    writeFileSync(file, `#!/bin/sh\n${body}\n`);
    chmodSync(file, 0o755);
  }
}
