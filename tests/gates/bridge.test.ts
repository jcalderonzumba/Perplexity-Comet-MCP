import { describe, expect, it } from "vitest";

import {
  BRIDGE_TOOLS,
  bridgeEntry,
  bridgeEntryIn,
  bridgePort,
  githubSlug,
  isFullSha,
  missingTools,
  pinnedSha,
} from "../../scripts/lib/bridge.mjs";
import { declaredTools } from "./support/declared-tools.js";

const SHA = "2a26569157f62dbe7b9d83c47ab2f9b4933c9988";
const SPEC = `github:owner/repo#${SHA}`;

describe("githubSlug", () => {
  it("reads owner/repo from an SSH remote", () => {
    expect(githubSlug("git@github.com:owner/repo.git")).toBe("owner/repo");
  });

  it("reads owner/repo from an HTTPS remote, with or without .git", () => {
    expect(githubSlug("https://github.com/owner/repo.git")).toBe("owner/repo");
    expect(githubSlug("https://github.com/owner/repo")).toBe("owner/repo");
  });

  it("refuses a remote that is not on GitHub", () => {
    expect(() => githubSlug("git@gitlab.com:owner/repo.git")).toThrow(
      "not a GitHub repository",
    );
  });
});

describe("isFullSha", () => {
  it("accepts a 40-character hex commit name", () => {
    expect(isFullSha(SHA)).toBe(true);
  });

  it("refuses a short sha, a branch name and upper case", () => {
    expect(isFullSha("2a26569")).toBe(false);
    expect(isFullSha("main")).toBe(false);
    expect(isFullSha(SHA.toUpperCase())).toBe(false);
  });
});

describe("bridgeEntryIn", () => {
  it("returns the user-scope comet-bridge entry", () => {
    const entry = { type: "stdio", command: "npx", args: ["-y", SPEC] };
    const config = JSON.stringify({
      mcpServers: { "comet-bridge": entry },
      projects: {},
    });
    expect(bridgeEntryIn(config)).toEqual(entry);
  });

  it("ignores a comet-bridge entry that belongs to one project only", () => {
    const config = JSON.stringify({
      mcpServers: {},
      projects: {
        "/some/project": { mcpServers: { "comet-bridge": { command: "x" } } },
      },
    });
    expect(bridgeEntryIn(config)).toBeNull();
  });

  it("returns null when there is no mcpServers key", () => {
    expect(bridgeEntryIn("{}")).toBeNull();
  });
});

describe("pinnedSha", () => {
  it("reads the commit an npx GitHub entry is pinned to", () => {
    expect(pinnedSha({ command: "npx", args: ["-y", SPEC] })).toBe(SHA);
  });

  it("is null for an entry that runs something else", () => {
    expect(pinnedSha({ command: "npx", args: ["-y", "comet-mcp@2.3.0"] })).toBe(
      null,
    );
    expect(pinnedSha({ command: "node", args: ["/x/dist/index.js"] })).toBe(
      null,
    );
    expect(pinnedSha(null)).toBe(null);
  });
});

describe("bridgePort", () => {
  it("prefers COMET_PORT from the environment", () => {
    expect(
      bridgePort({ COMET_PORT: "9333" }, { env: { COMET_PORT: "9222" } }),
    ).toBe("9333");
  });

  it("keeps the current entry's COMET_PORT otherwise", () => {
    expect(bridgePort({}, { env: { COMET_PORT: "9222" } })).toBe("9222");
  });

  it("falls back to the server's default port", () => {
    expect(bridgePort({}, { command: "npx" })).toBe("9223");
    expect(bridgePort({}, null)).toBe("9223");
  });
});

describe("bridgeEntry", () => {
  it("runs the pinned build with npx and passes the port", () => {
    expect(bridgeEntry(SPEC, "9222")).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", SPEC],
      env: { COMET_PORT: "9222" },
    });
  });
});

describe("bridgeEntry with an environment to keep", () => {
  it("keeps every other variable and sets COMET_PORT", () => {
    expect(
      bridgeEntry(SPEC, "9444", {
        COMET_PATH: "/opt/Comet",
        COMET_PORT: "9222",
      }).env,
    ).toEqual({ COMET_PATH: "/opt/Comet", COMET_PORT: "9444" });
  });
});

describe("BRIDGE_TOOLS", () => {
  it("names every tool the stdio server declares", () => {
    expect([...BRIDGE_TOOLS].sort()).toEqual(
      [...declaredTools().keys()].sort(),
    );
  });
});

describe("missingTools", () => {
  it("lists the expected tools a build does not offer", () => {
    expect(missingTools(["comet_ask", "comet_connect"])).toEqual(
      BRIDGE_TOOLS.filter(
        (tool) => tool !== "comet_ask" && tool !== "comet_connect",
      ),
    );
  });

  it("is empty when every expected tool is offered, extras allowed", () => {
    expect(missingTools([...BRIDGE_TOOLS, "comet_new"])).toEqual([]);
  });
});
