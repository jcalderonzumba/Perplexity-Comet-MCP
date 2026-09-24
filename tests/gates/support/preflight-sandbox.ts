/**
 * A throwaway repository holding a copy of `scripts/` (`preflight.mjs`,
 * `check.mjs` and their library), for tests that run the gates themselves. The
 * commands their steps run (`npm`, `npx`, `node`) are stand-ins on `PATH` that
 * pass without doing any work and log how they were called, so a test decides
 * what fails and sees what ran.
 */
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

import {
  findOnPath,
  GitSandbox,
  type Outcome,
  repoRoot,
  runProcess,
} from "./git-sandbox.ts";

/** What `npm pack --dry-run --json` lists for a package preflight accepts. */
const PACKED = JSON.stringify([
  {
    files: ["package.json", "dist/index.js", "README.md", "LICENSE"].map(
      (path) => ({ path }),
    ),
  },
]);

const STAND_INS: Readonly<Record<string, string>> = {
  npm: `[ "$1" = pack ] && echo '${PACKED}'\nexit 0`,
  npx: "exit 0",
  node: "exit 0",
};

const RULES = join("scripts", "lib", "preflight-rules.mjs");

export class PreflightSandbox {
  readonly repository = new GitSandbox();
  readonly #bin = mkdtempSync(join(tmpdir(), "comet-mcp-stand-ins-"));
  readonly #log = join(this.#bin, "commands.log");

  constructor() {
    cpSync(join(repoRoot, "scripts"), join(this.root, "scripts"), {
      recursive: true,
    });
    writeFileSync(join(this.root, ".gitignore"), ".work/\ndist/\n");
    for (const [tool, body] of Object.entries(STAND_INS))
      this.standIn(tool, `echo "${tool} $*" >> '${this.#log}'\n${body}`);
    this.repository.commit("preflight scripts");
  }

  get root(): string {
    return this.repository.root;
  }

  get notebook(): string {
    return join(this.root, ".work");
  }

  /** Gives the clone a clean notebook repository with one commit. */
  addNotebook(): void {
    mkdirSync(this.notebook);
    writeFileSync(join(this.notebook, "plan.md"), "# Plan\n");
    for (const args of [
      ["init", "--quiet"],
      ["add", "--all"],
      ["commit", "--quiet", "--message", "plan"],
    ]) {
      const outcome = runProcess("git", ["-C", this.notebook, ...args]);
      if (outcome.status !== 0)
        throw new Error(`git ${args.join(" ")} failed: ${outcome.stderr}`);
    }
  }

  /** Gives the clone a `.work/` directory that is not a git repository. */
  addPlainNotebookDirectory(): void {
    mkdirSync(this.notebook);
    writeFileSync(join(this.notebook, "plan.md"), "# Plan\n");
  }

  /** Makes `git` fail, as a broken repository would, when called with exactly `args`. */
  failGit(args: string): void {
    this.standIn(
      "git",
      `if [ "$*" = '${args}' ]; then echo "fatal: stand-in failure" >&2; exit 128; fi\n` +
        `exec '${findOnPath("git")}' "$@"`,
    );
  }

  /** Puts a stand-in `tool` running this shell `body` first on preflight's `PATH`. */
  standIn(tool: string, body: string): void {
    const file = join(this.#bin, tool);
    writeFileSync(file, `#!/bin/sh\n${body}\n`);
    chmodSync(file, 0o755);
  }

  /**
   * Commits a copy of the preflight rules whose live battery limit is `ms`,
   * the rest of the rules unchanged, so a test can show preflight applying
   * the limit without waiting ten minutes.
   */
  limitLiveBatteryTo(ms: number): void {
    const original = "preflight-rules.original.mjs";
    renameSync(
      join(this.root, RULES),
      join(this.root, dirname(RULES), original),
    );
    writeFileSync(
      join(this.root, RULES),
      `export * from "./${original}";\nexport const LIVE_BATTERY_TIMEOUT_MS = ${ms};\n`,
    );
    this.repository.commit(`live battery limited to ${ms} ms`);
  }

  /** Runs `scripts/preflight.mjs` with the real node and the stand-ins first on `PATH`. */
  preflight(args: readonly string[] = []): Outcome {
    return this.#runScript("scripts/preflight.mjs", args);
  }

  /** Runs `scripts/check.mjs` the same way. */
  check(): Outcome {
    return this.#runScript("scripts/check.mjs", []);
  }

  /** Each stand-in call so far, as `<tool> <args…>`, in the order they ran. */
  commandsRun(): string[] {
    if (!existsSync(this.#log)) return [];
    return readFileSync(this.#log, "utf8").trimEnd().split("\n");
  }

  /** The approval file's raw content, or null when preflight never wrote it. */
  approvals(): string | null {
    const file = join(this.root, ".git", "preflight-ok");
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  }

  #runScript(script: string, args: readonly string[]): Outcome {
    return runProcess(process.execPath, [script, ...args], {
      cwd: this.root,
      env: {
        NO_COLOR: "1",
        PATH: `${this.#bin}${delimiter}${process.env.PATH ?? ""}`,
      },
    });
  }

  remove(): void {
    this.repository.remove();
    rmSync(this.#bin, { recursive: true, force: true });
  }
}
