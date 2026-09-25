/**
 * The notebook's post-commit hook (`.githooks/notebook/post-commit`), run as
 * git runs it: a throwaway public clone holding a copy of `.githooks/`, a
 * notebook repository nested in it at `.work/` that opts in with
 * `core.hooksPath ../.githooks/notebook`, and a local bare repository as the
 * notebook's remote.
 */
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GitSandbox, type Outcome, runProcess } from "./support/git-sandbox.ts";

const NOTEBOOK_HOOKS_PATH = "../.githooks/notebook";
const CONNECT_TIMEOUT_MS = 5_000;
/** Each test runs several git commands, slow when the whole suite runs at once. */
const GIT_HEAVY_TEST_MS = 30_000;

function git(directory: string, ...args: string[]): string {
  const outcome = runProcess("git", ["-C", directory, ...args]);
  if (outcome.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${outcome.stderr}`);
  return outcome.stdout.trim();
}

/** A bare repository standing in for a private remote. */
class BareRemote {
  readonly path = mkdtempSync(join(tmpdir(), "comet-mcp-remote-"));

  constructor() {
    git(this.path, "init", "--quiet", "--bare", "--initial-branch=main");
  }

  head(branch = "main"): string {
    return git(this.path, "rev-parse", branch);
  }

  hasBranch(branch: string): boolean {
    const verify = ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`];
    return runProcess("git", ["-C", this.path, ...verify]).status === 0;
  }

  /** Moves `main` on from another clone, as a second machine would. */
  advanceElsewhere(): string {
    const elsewhere = mkdtempSync(join(tmpdir(), "comet-mcp-elsewhere-"));
    try {
      git(elsewhere, "clone", "--quiet", this.path, ".");
      writeFileSync(join(elsewhere, "elsewhere.md"), "written elsewhere\n");
      git(elsewhere, "add", "--all");
      git(elsewhere, "commit", "--quiet", "--message", "elsewhere");
      git(elsewhere, "push", "--quiet", "origin", "main");
      return this.head();
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  }

  remove(): void {
    rmSync(this.path, { recursive: true, force: true });
  }
}

/** A notebook repository at `<clone>/.work`, pushed once to its remote. */
class Notebook {
  readonly path: string;
  #commits = 0;

  constructor(clone: GitSandbox, remote: BareRemote) {
    this.path = join(clone.root, ".work");
    git(clone.root, "init", "--quiet", "--initial-branch=main", this.path);
    this.#write("plan.md", "# Plan\n");
    git(this.path, "add", "--all");
    git(this.path, "commit", "--quiet", "--message", "plan");
    git(this.path, "remote", "add", "origin", remote.path);
    git(this.path, "push", "--quiet", "--set-upstream", "origin", "main");
    git(this.path, "config", "core.hooksPath", NOTEBOOK_HOOKS_PATH);
  }

  /** Commits one change the way an agent does, hooks included. */
  commit(): Outcome & { readonly elapsedMs: number } {
    this.#commits += 1;
    this.#write("progress.md", `tick ${this.#commits}\n`);
    git(this.path, "add", "--all");
    const started = Date.now();
    const outcome = runProcess("git", [
      "-C",
      this.path,
      "commit",
      "--quiet",
      "--message",
      `tick ${this.#commits}`,
    ]);
    return { ...outcome, elapsedMs: Date.now() - started };
  }

  head(): string {
    return git(this.path, "rev-parse", "HEAD");
  }

  setRemote(url: string): void {
    git(this.path, "remote", "set-url", "origin", url);
  }

  #write(name: string, text: string): void {
    writeFileSync(join(this.path, name), text);
  }
}

/** A TCP listener that accepts connections and never says a word. */
async function silentListener(): Promise<{ server: Server; port: number }> {
  const server = createServer(() => {});
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("the listener has no port");
  return { server, port: address.port };
}

let clone: GitSandbox;
let remote: BareRemote;
let notebook: Notebook;

beforeEach(() => {
  clone = new GitSandbox();
  remote = new BareRemote();
  notebook = new Notebook(clone, remote);
});

afterEach(() => {
  clone.remove();
  remote.remove();
});

describe("the notebook's post-commit hook", {
  timeout: GIT_HEAVY_TEST_MS,
}, () => {
  it("pushes a commit to the remote", () => {
    const outcome = notebook.commit();
    expect(outcome.status).toBe(0);
    expect(remote.head()).toBe(notebook.head());
  });

  it("keeps a commit it cannot push, warns, and pushes it with the next", () => {
    const pushed = remote.head();
    notebook.setRemote(join(remote.path, "missing"));

    const offline = notebook.commit();
    expect(offline.status).toBe(0);
    expect(offline.stderr).toContain("post-commit: could not push main");
    expect(remote.head()).toBe(pushed);
    const pending = notebook.head();

    notebook.setRemote(remote.path);
    const online = notebook.commit();
    expect(online.status).toBe(0);
    expect(remote.head()).toBe(notebook.head());
    expect(git(remote.path, "rev-parse", "main~1")).toBe(pending);
  });

  it("never force-pushes over a remote that moved on", () => {
    const theirs = remote.advanceElsewhere();

    const outcome = notebook.commit();
    expect(outcome.status).toBe(0);
    expect(outcome.stderr).toContain("post-commit: could not push main");
    expect(remote.head()).toBe(theirs);
  });

  it("warns and pushes nothing from a branch with no upstream", () => {
    const pushed = remote.head();
    git(notebook.path, "switch", "--quiet", "--create", "draft");

    const outcome = notebook.commit();
    expect(outcome.status).toBe(0);
    expect(outcome.stderr).toContain("post-commit: draft has no upstream");
    expect(remote.head()).toBe(pushed);
    expect(remote.hasBranch("draft")).toBe(false);
  });

  it("gives up on an SSH remote that never answers within the connect timeout", async () => {
    const { server, port } = await silentListener();
    try {
      notebook.setRemote(`ssh://git@127.0.0.1:${port}/notebook.git`);
      const outcome = notebook.commit();
      expect(outcome.status).toBe(0);
      expect(outcome.stderr).toContain("post-commit: could not push main");
      expect(outcome.elapsedMs).toBeGreaterThanOrEqual(
        CONNECT_TIMEOUT_MS - 500,
      );
      expect(outcome.elapsedMs).toBeLessThan(CONNECT_TIMEOUT_MS + 10_000);
    } finally {
      server.close();
    }
  });

  it("keeps a configured SSH command and adds the timeout to it", () => {
    const log = join(clone.root, "ssh.log");
    const standIn = join(clone.root, "ssh-stand-in");
    writeFileSync(standIn, `#!/bin/sh\necho "$*" >> '${log}'\nexit 255\n`);
    chmodSync(standIn, 0o755);
    git(notebook.path, "config", "core.sshCommand", standIn);
    notebook.setRemote("ssh://git@notebook.invalid/notebook.git");

    expect(notebook.commit().status).toBe(0);
    expect(existsSync(log)).toBe(true);
    expect(readFileSync(log, "utf8")).toContain("-o ConnectTimeout=5");
  });
});

describe("the public repository", { timeout: GIT_HEAVY_TEST_MS }, () => {
  it("never runs the notebook hook", () => {
    expect(existsSync(join(clone.root, ".githooks/notebook/post-commit"))).toBe(
      true,
    );
    const publicRemote = new BareRemote();
    try {
      clone.git("config", "core.hooksPath", ".githooks");
      writeFileSync(join(clone.root, ".gitignore"), ".work/\n");
      clone.git("switch", "--quiet", "--create", "feat/x");
      clone.git("add", ".gitignore");
      clone.git("commit", "--quiet", "--message", "ignore the notebook");
      clone.git("remote", "add", "origin", publicRemote.path);
      clone.git(
        "push",
        "--quiet",
        "--no-verify",
        "--set-upstream",
        "origin",
        "feat/x",
      );
      const pushed = publicRemote.head("feat/x");

      writeFileSync(join(clone.root, "change.txt"), "public change\n");
      clone.git("add", "change.txt");
      clone.git("commit", "--quiet", "--message", "public change");

      expect(clone.head()).not.toBe(pushed);
      expect(publicRemote.head("feat/x")).toBe(pushed);
    } finally {
      publicRemote.remove();
    }
  });
});
