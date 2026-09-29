// The bridge's entry file reads its settings before it builds anything: with
// no COMET_BRIDGE_TOKEN it prints its error and exits before it listens.

import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MISSING_TOKEN_MESSAGE,
  readBridgeConfig,
} from "../../src/bridge-server.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("readBridgeConfig", () => {
  it("refuses an environment without a token", () => {
    expect(() => readBridgeConfig({})).toThrow(MISSING_TOKEN_MESSAGE);
    expect(() => readBridgeConfig({ COMET_BRIDGE_TOKEN: "" })).toThrow(
      MISSING_TOKEN_MESSAGE,
    );
  });

  it("defaults the port and the host, and leaves CORS off", () => {
    expect(readBridgeConfig({ COMET_BRIDGE_TOKEN: "t" })).toEqual({
      token: "t",
      port: 3210,
      host: "0.0.0.0",
      corsOrigin: null,
    });
  });

  it("reads the port, the host and the CORS origin", () => {
    expect(
      readBridgeConfig({
        COMET_BRIDGE_TOKEN: "t",
        COMET_BRIDGE_PORT: "4000",
        COMET_BRIDGE_HOST: "127.0.0.1",
        COMET_BRIDGE_CORS_ORIGIN: "https://n8n.example.com",
      }),
    ).toEqual({
      token: "t",
      port: 4000,
      host: "127.0.0.1",
      corsOrigin: "https://n8n.example.com",
    });
  });
});

describe("the http-bridge entry", () => {
  it("exits with its error, before listening, when COMET_BRIDGE_TOKEN is not set", async () => {
    vi.stubEnv("COMET_BRIDGE_TOKEN", "");
    const listen = vi.spyOn(http.Server.prototype, "listen");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });

    await expect(import("../../src/http-bridge.js")).rejects.toThrow("exit 1");

    expect(exit).toHaveBeenCalledWith(1);
    expect(errors.mock.calls.flat().join("\n")).toContain(
      `ERROR: ${MISSING_TOKEN_MESSAGE}`,
    );
    expect(listen).not.toHaveBeenCalled();
  });
});
