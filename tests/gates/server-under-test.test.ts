import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

import {
  debugPortFromEnv,
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
