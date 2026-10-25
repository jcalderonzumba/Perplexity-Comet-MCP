// The host's reads of Comet's `DevToolsActivePort` against real files in a
// temporary directory, and its TCP check against a socket the test listens on.

import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listensOnLoopback,
  readDevToolsActivePort,
} from "../../src/comet-launch.js";

const TEXT = "9222\n/devtools/browser/0f1e2d3c-4b5a-6978-8a9b-acbdcedf0102";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "comet-active-port-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readDevToolsActivePort on real files", () => {
  it("reads a regular file", async () => {
    const path = join(dir, "DevToolsActivePort");
    await writeFile(path, TEXT);

    expect(await readDevToolsActivePort(path)).toBe(TEXT);
  });

  it("reads a file of exactly 1 KiB", async () => {
    const path = join(dir, "DevToolsActivePort");
    await writeFile(path, "x".repeat(1024));

    expect(await readDevToolsActivePort(path)).toHaveLength(1024);
  });

  it("is null for a symlink, even to a regular file", async () => {
    const target = join(dir, "elsewhere");
    await writeFile(target, TEXT);
    const path = join(dir, "DevToolsActivePort");
    await symlink(target, path);

    expect(await readDevToolsActivePort(path)).toBeNull();
  });

  it("is null for a directory", async () => {
    const path = join(dir, "DevToolsActivePort");
    await mkdir(path);

    expect(await readDevToolsActivePort(path)).toBeNull();
  });

  it("is null for a 2 KiB file", async () => {
    const path = join(dir, "DevToolsActivePort");
    await writeFile(path, "x".repeat(2048));

    expect(await readDevToolsActivePort(path)).toBeNull();
  });

  it("is null when there is no file", async () => {
    expect(
      await readDevToolsActivePort(join(dir, "DevToolsActivePort")),
    ).toBeNull();
  });
});

describe("listensOnLoopback", () => {
  let server: Server;

  afterEach(() => {
    server?.close();
  });

  /** Listens on a free port of 127.0.0.1, and returns it. */
  async function listening(): Promise<number> {
    server = createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("no port");
    }
    return address.port;
  }

  it("is true when something listens on the port", async () => {
    expect(await listensOnLoopback(await listening())).toBe(true);
  });

  it("is false once nothing listens there", async () => {
    const port = await listening();
    await new Promise((resolve) => server.close(resolve));

    expect(await listensOnLoopback(port)).toBe(false);
  });
});
