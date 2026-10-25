import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

import { parseDevToolsActivePort as serversParse } from "../../src/core/browser-endpoint.js";
import {
  activePortPath,
  debugPortFromEnv,
  parseDevToolsActivePort,
  serverUnderTest,
} from "../lib/server-under-test.mjs";

const ENTRY = "/repo/dist/index.js";

describe("debugPortFromEnv", () => {
  it("defaults to the server's port, 9223", () => {
    expect(debugPortFromEnv({})).toBe(9223);
  });

  it("reads COMET_PORT, as the server does", () => {
    expect(debugPortFromEnv({ COMET_PORT: "9222" })).toBe(9222);
  });

  it("falls back to 9223 on a value the server rejects", () => {
    expect(debugPortFromEnv({ COMET_PORT: "not-a-port" })).toBe(9223);
    expect(debugPortFromEnv({ COMET_PORT: "70000" })).toBe(9223);
    expect(debugPortFromEnv({ COMET_PORT: "0" })).toBe(9223);
  });
});

describe("serverUnderTest", () => {
  it("starts the built entry with node", () => {
    const { parameters } = serverUnderTest(ENTRY, {});
    expect(parameters.command).toBe("node");
    expect(parameters.args).toEqual([ENTRY]);
  });

  it("gives the server the port the battery checks, when COMET_PORT is set", () => {
    const server = serverUnderTest(ENTRY, { COMET_PORT: "9222" });
    expect(server.port).toBe(9222);
    expect(server.parameters.env?.COMET_PORT).toBe("9222");
  });

  it("gives the server the default port the battery checks, when COMET_PORT is unset", () => {
    const server = serverUnderTest(ENTRY, {});
    expect(server.port).toBe(9223);
    expect(server.parameters.env?.COMET_PORT).toBe("9223");
  });

  it("gives the server the port the battery checks, when COMET_PORT is not a port", () => {
    const server = serverUnderTest(ENTRY, { COMET_PORT: "not-a-port" });
    expect(server.port).toBe(9223);
    expect(server.parameters.env?.COMET_PORT).toBe("9223");
  });

  it("keeps the SDK's default environment and adds no other caller variable", () => {
    const { parameters } = serverUnderTest(ENTRY, {
      COMET_PORT: "9222",
      UNRELATED_SECRET: "must-not-reach-the-server",
    });
    expect(parameters.env).toEqual({
      ...getDefaultEnvironment(),
      COMET_PORT: "9222",
    });
  });
});

describe("the battery's DevToolsActivePort parser", () => {
  const UUID = "0b3f5c2e-8d1a-4e7b-9c6d-2A4F8E1B7C3D";
  const PATH = `/devtools/browser/${UUID}`;
  const CASES = [
    `9222\n${PATH}\n`,
    `9222\n${PATH}`,
    `65535\n${PATH}\n`,
    "",
    `0\n${PATH}\n`,
    `65536\n${PATH}\n`,
    ` 9222\n${PATH}\n`,
    `${PATH}\n9222\n`,
    `9222\n/devtools/page/${UUID}\n`,
    `9222\nws://127.0.0.1:9222${PATH}\n`,
    `9222\n/devtools/browser/../${UUID}\n`,
    `9222\n${PATH}?x=1\n`,
    `9222\n${PATH}/\n`,
    `9222\n${PATH}\nextra\n`,
  ];

  it("reads every case as the server does", () => {
    for (const text of CASES) {
      expect(parseDevToolsActivePort(text), JSON.stringify(text)).toEqual(
        serversParse(text),
      );
    }
  });

  it("accepts the real file and rejects the rest", () => {
    expect(parseDevToolsActivePort(`9222\n${PATH}\n`)).toEqual({
      port: 9222,
      path: PATH,
    });
    expect(CASES.filter((text) => parseDevToolsActivePort(text))).toHaveLength(
      3,
    );
  });
});

describe("activePortPath", () => {
  it("is Comet's file in its profile on macOS", () => {
    expect(activePortPath("darwin", "/Users/someone")).toBe(
      "/Users/someone/Library/Application Support/Comet/DevToolsActivePort",
    );
  });

  it("is null on every other platform, WSL's Linux included", () => {
    for (const os of ["linux", "win32"] as const) {
      expect(activePortPath(os, "/home/someone")).toBeNull();
    }
  });
});
