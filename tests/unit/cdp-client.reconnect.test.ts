import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CometCDPClient } from "../../src/cdp-client.js";
import type { BrowserTarget } from "../../src/core/perplexity-tab.js";
import type { CDPTarget } from "../../src/types.js";
import { FakeBrowser } from "./fakes/fake-browser.js";
import { answeringLaunch } from "./fakes/fake-comet-launch.js";
import {
  LOOKALIKE_TAB,
  MAIN_TAB,
  SIDECAR_NAMED_THREAD,
  SIDECAR_TAB,
  USER_TAB,
} from "./fakes/fake-tab-port.js";

// The client picks the tab to reconnect to by the one rule for Perplexity's
// main page. The browser socket opens on a fake browser, the listed targets
// and the tab moves are stubbed, and the launch says Comet answers on its
// port.
const cdp = vi.hoisted(() => ({
  browser: null as unknown as { open(options: unknown): unknown },
}));

vi.mock("chrome-remote-interface", () => ({
  default: Object.assign(
    async (options: unknown) => cdp.browser.open(options),
    {
      ProtocolError: class extends Error {},
    },
  ),
}));

beforeEach(() => {
  cdp.browser = new FakeBrowser();
});

afterEach(() => {
  vi.useRealTimers();
});

function listed(...targets: BrowserTarget[]): CDPTarget[] {
  return targets.map((target) => ({ ...target, title: "" }));
}

function clientListing(...targets: BrowserTarget[]) {
  const client = new CometCDPClient({ port: 9222, launch: answeringLaunch() });
  const connect = vi.spyOn(client, "connect").mockResolvedValue("connected");
  vi.spyOn(client, "listTargets").mockResolvedValue(listed(...targets));
  return { client, connect };
}

describe("CometCDPClient.reconnect's tab choice", () => {
  it("picks the main page over a sidecar listed first", async () => {
    const { client, connect } = clientListing(SIDECAR_TAB, MAIN_TAB);

    await client.reconnect();

    expect(connect).toHaveBeenCalledWith(MAIN_TAB.id);
  });

  it("picks the main page over a page whose address merely contains perplexity.ai", async () => {
    const { client, connect } = clientListing(LOOKALIKE_TAB, MAIN_TAB);

    await client.reconnect();

    expect(connect).toHaveBeenCalledWith(MAIN_TAB.id);
  });

  it("takes a Perplexity thread whose address names a sidecar for the main page", async () => {
    const { client, connect } = clientListing(
      SIDECAR_TAB,
      SIDECAR_NAMED_THREAD,
    );

    await client.reconnect();

    expect(connect).toHaveBeenCalledWith(SIDECAR_NAMED_THREAD.id);
  });

  it("never connects to the sidecar when it is the only Perplexity page", async () => {
    const { client, connect } = clientListing(SIDECAR_TAB, USER_TAB);

    await client.reconnect();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(USER_TAB.id);
  });

  it("fails when the sidecar is the only page", async () => {
    const { client, connect } = clientListing(SIDECAR_TAB);

    await expect(client.reconnect()).rejects.toThrow(
      "No suitable tab found for reconnection",
    );
    expect(connect).not.toHaveBeenCalled();
  });
});

describe("CometCDPClient.withAutoReconnect's fresh start", () => {
  it("picks the main page over a sidecar listed first, and over a lookalike", async () => {
    vi.useFakeTimers();
    const { client, connect } = clientListing(
      SIDECAR_TAB,
      LOOKALIKE_TAB,
      MAIN_TAB,
    );
    // The first reconnect fails, so the fresh start runs.
    vi.spyOn(client, "listTargets")
      .mockRejectedValueOnce(new Error("targets unreadable"))
      .mockResolvedValue(listed(SIDECAR_TAB, LOOKALIKE_TAB, MAIN_TAB));
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("WebSocket is not open"))
      .mockResolvedValue("done");

    const pending = client.withAutoReconnect(operation);
    await vi.advanceTimersByTimeAsync(5000);

    await expect(pending).resolves.toBe("done");
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(MAIN_TAB.id);
  });
});
