import { describe, expect, it } from "vitest";
import { CometCDPClient } from "../../src/cdp-client.js";

const NOT_CONNECTED = "Not connected to Comet. Call connect() first.";

// A call made before `connect()` has no connection to use: it fails with the
// client's own words, never with a TypeError from reading a missing client.
describe("CometCDPClient before it is connected", () => {
  const calls: Array<[string, (client: CometCDPClient) => Promise<unknown>]> = [
    ["navigate", (client) => client.navigate("https://www.perplexity.ai/")],
    ["screenshot", (client) => client.screenshot()],
    ["evaluate", (client) => client.evaluate("1 + 1")],
    ["pageAddress", (client) => client.pageAddress()],
    ["stopFocusEmulation", (client) => client.stopFocusEmulation()],
    ["insertText", (client) => client.insertText("hello")],
    ["pressKey", (client) => client.pressKey("Enter")],
    ["clickAt", (client) => client.clickAt({ x: 1, y: 1 })],
    ["startFocusEmulation", (client) => client.startFocusEmulation()],
  ];

  it.each(calls)(
    "%s fails with the not-connected error",
    async (_name, call) => {
      const failure = await call(new CometCDPClient()).catch(
        (error: unknown) => error,
      );

      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(TypeError);
      expect((failure as Error).message).toBe(NOT_CONNECTED);
    },
  );
});
