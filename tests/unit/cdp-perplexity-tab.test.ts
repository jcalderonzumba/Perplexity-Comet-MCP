import { afterEach, describe, expect, it, vi } from "vitest";
import { createCdpPerplexityTab } from "../../src/cdp-perplexity-tab.js";
import { TAB_TIMING } from "../../src/core/perplexity-tab.js";
import { PERPLEXITY_HOME } from "../../src/perplexity-pages.js";
import { FakeTabPort, SIDECAR_TAB, USER_TAB } from "./fakes/fake-tab-port.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("createCdpPerplexityTab", () => {
  /** A client whose own wait must go unused: the tab choice waits on timers. */
  function clientOn(...targets: (typeof SIDECAR_TAB)[]): FakeTabPort {
    const client = new FakeTabPort();
    client.targets = [...targets];
    client.url = targets[0].url;
    return client;
  }

  it("opens Perplexity's home page through the client, waits on the clock, and records the tab", async () => {
    vi.useFakeTimers();
    const client = clientOn(SIDECAR_TAB, USER_TAB);
    const tab = createCdpPerplexityTab(client);

    let settled = false;
    const moving = tab.bringToMainPage().then((move) => {
      settled = true;
      return move;
    });
    await vi.advanceTimersByTimeAsync(TAB_TIMING.openedSettleMs - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await moving).toBe("opened");
    expect(client.openedAt).toEqual([PERPLEXITY_HOME]);
    expect(client.connectedTo).toEqual(["opened-1"]);
    expect(client.waitedMs).toBe(0);
    expect(tab.opened("opened-1")).toBe(true);
  });
});
