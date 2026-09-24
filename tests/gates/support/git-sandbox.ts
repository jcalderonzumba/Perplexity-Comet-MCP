/**
 * A throwaway git repository holding copies of the repository's hooks, for
 * tests that run the gate scripts the way git and Claude Code run them: as
 * child processes, against a real `.git/`.
 */
import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  cpSync,
  existsSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export type Outcome = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

export type RunOptions = {
  readonly cwd?: string;
  readonly stdin?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Variables removed from the child's environment, after `env` is applied. */
  readonly unsetEnv?: readonly string[];
};

/** Git configured for a test: no global or system config, a fixed author. */
const GIT_ENV: NodeJS.ProcessEnv = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@comet-mcp.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@comet-mcp.invalid",
};

export function runProcess(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Outcome {
  const env: NodeJS.ProcessEnv = { ...process.env, ...GIT_ENV, ...options.env };
  for (const name of options.unsetEnv ?? []) delete env[name];
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    input: options.stdin ?? "",
    encoding: "utf8",
    env,
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export class GitSandbox {
  readonly root: string;

  constructor() {
    this.root = mkdtempSync(join(tmpdir(), "comet-mcp-hooks-"));
    this.git("init", "--quiet", "--initial-branch=main");
    for (const hooks of [".githooks", ".claude/hooks"]) {
      const source = join(repoRoot, hooks);
      if (existsSync(source))
        cpSync(source, join(this.root, hooks), { recursive: true });
    }
    // preflight-check.sh gates only a repository that has a preflight script.
    writeFileSync(
      join(this.root, "package.json"),
      '{ "scripts": { "preflight": "true" } }\n',
    );
    this.commit("initial");
  }

  git(...args: string[]): string {
    const outcome = runProcess("git", ["-C", this.root, ...args]);
    if (outcome.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${outcome.stderr}`);
    }
    return outcome.stdout.trim();
  }

  /** Commits a change and returns the new HEAD. */
  commit(message: string): string {
    writeFileSync(join(this.root, "change.txt"), `${message}\n`);
    this.git("add", "--all");
    this.git("commit", "--quiet", "--no-verify", "--message", message);
    return this.head();
  }

  head(): string {
    return this.git("rev-parse", "HEAD");
  }

  /** Writes a stamp file under `.git/` listing exactly these shas. */
  stamp(name: "review-ok" | "preflight-ok", shas: readonly string[]): void {
    writeFileSync(
      join(this.root, ".git", name),
      shas.map((sha) => `${sha}\n`).join(""),
    );
  }

  /** Runs one of the copied hook scripts, relative to the sandbox root. */
  run(
    script: string,
    args: readonly string[] = [],
    options: RunOptions = {},
  ): Outcome {
    return runProcess(join(this.root, script), args, {
      cwd: this.root,
      ...options,
    });
  }

  remove(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}

/**
 * A `PATH` holding only the named tools, linked from wherever the real `PATH`
 * finds them, so a test can run a script on a machine that lacks one tool.
 */
export function pathWith(tools: readonly string[]): string {
  const bin = mkdtempSync(join(tmpdir(), "comet-mcp-bin-"));
  for (const tool of tools) symlinkSync(findOnPath(tool), join(bin, tool));
  return bin;
}

/** Where the real `PATH` finds an executable `tool`. */
export function findOnPath(tool: string): string {
  const found = (process.env.PATH ?? "")
    .split(delimiter)
    .map((directory) => join(directory, tool))
    .find((candidate) => {
      try {
        accessSync(candidate, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
  if (found === undefined) throw new Error(`${tool} is not on PATH`);
  return found;
}
