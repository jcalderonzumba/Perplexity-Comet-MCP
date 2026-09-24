/**
 * A throwaway repository holding a copy of `scripts/preflight.mjs` and its
 * library, for tests that run preflight itself. The commands its steps run
 * (`npm`, `npx`, `node`) are stand-ins on `PATH` that pass without doing any
 * work, so a test decides what fails.
 */
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

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

export class PreflightSandbox {
  readonly repository = new GitSandbox();
  readonly #bin = mkdtempSync(join(tmpdir(), "comet-mcp-stand-ins-"));

  constructor() {
    cpSync(join(repoRoot, "scripts"), join(this.root, "scripts"), {
      recursive: true,
    });
    writeFileSync(join(this.root, ".gitignore"), ".work/\ndist/\n");
    for (const [tool, body] of Object.entries(STAND_INS))
      this.standIn(tool, body);
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

  /** Runs `scripts/preflight.mjs` with the real node and the stand-ins first on `PATH`. */
  preflight(args: readonly string[] = []): Outcome {
    return runProcess(process.execPath, ["scripts/preflight.mjs", ...args], {
      cwd: this.root,
      env: {
        NO_COLOR: "1",
        PATH: `${this.#bin}${delimiter}${process.env.PATH ?? ""}`,
      },
    });
  }

  /** The approval file's raw content, or null when preflight never wrote it. */
  approvals(): string | null {
    const file = join(this.root, ".git", "preflight-ok");
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  }

  remove(): void {
    this.repository.remove();
    rmSync(this.#bin, { recursive: true, force: true });
  }
}
