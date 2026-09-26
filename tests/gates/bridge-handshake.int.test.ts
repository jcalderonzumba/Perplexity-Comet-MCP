/**
 * `toolsOffered` starts a real child process as an MCP client does: the fake
 * build from the SDK, or a process that never answers.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { toolsOffered } from "../../scripts/lib/bridge-handshake.mjs";
import { repoRoot } from "./support/git-sandbox.ts";

const FAKE_BUILD = join(repoRoot, "tests/gates/support/fake-bridge-server.mjs");

describe("toolsOffered", { timeout: 20_000 }, () => {
  it("lists the tools the build declares", async () => {
    const tools = await toolsOffered({
      command: process.execPath,
      args: [FAKE_BUILD],
      env: { FAKE_BRIDGE_TOOLS: "comet_ask,comet_mode" },
    });
    expect(tools).toEqual(["comet_ask", "comet_mode"]);
  });

  it("gives the SDK its limit, and refuses a silent build with what it wrote to stderr", async () => {
    const silent = {
      command: process.execPath,
      args: [
        "-e",
        "console.error('still building'); setInterval(() => {}, 1000)",
      ],
    };
    await expect(toolsOffered(silent, 1000)).rejects.toThrow(
      /Request timed out[\s\S]*still building/,
    );
  });
});
