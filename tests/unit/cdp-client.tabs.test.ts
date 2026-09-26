import { beforeEach, describe, expect, it, vi } from "vitest";
import { CometCDPClient } from "../../src/cdp-client.js";
import type { BrowserTarget } from "../../src/core/perplexity-tab.js";
import type { CDPTarget } from "../../src/types.js";
import { FakeCdpConnection } from "./fakes/fake-cdp-connection.js";
import {
  LOOKALIKE_TAB,
  MAIN_TAB,
  SIDECAR_NAMED_THREAD,
  SIDECAR_TAB,
  USER_TAB,
} from "./fakes/fake-tab-port.js";

// `CometCDPClient.connect` opens its connection through
// `chrome-remote-interface`; the tests hand it a fake tab instead.
const cdp = vi.hoisted(() => ({
  connection: null as unknown,
}));

vi.mock("chrome-remote-interface", () => ({
  default: Object.assign(async () => cdp.connection, {
    ProtocolError: class extends Error {},
  }),
}));

let tab: FakeCdpConnection;
let client: CometCDPClient;

beforeEach(async () => {
  tab = new FakeCdpConnection();
  cdp.connection = tab;
  client = new CometCDPClient();
  await client.connect("tab-1");
  tab.evaluations.length = 0;
});

describe("CometCDPClient.pageAddress", () => {
  it("reads the top frame's address from the browser's frame tree", async () => {
    tab.moveTo("https://www.perplexity.ai/sidecar?copilot=true");

    expect(await client.pageAddress()).toBe(
      "https://www.perplexity.ai/sidecar?copilot=true",
    );
    expect(tab.frameTreeReads).toBe(1);
  });

  it("reads it afresh, never from page script, so a page cannot answer for itself", async () => {
    tab.moveTo("https://news.example/today");
    tab.pageClaims = "https://www.perplexity.ai/";

    expect(await client.pageAddress()).toBe("https://news.example/today");
    expect(tab.evaluations).toEqual([]);
  });

  it("fails with the not-connected error before any connection exists", async () => {
    await expect(new CometCDPClient().pageAddress()).rejects.toThrow(
      "Not connected to Comet. Call connect() first.",
    );
  });
});

/** The browser's target list, as `listTargets` returns it. */
function listed(...targets: BrowserTarget[]): CDPTarget[] {
  return targets.map((target) => ({ ...target, title: "" }));
}

describe("CometCDPClient.listTabsCategorized", () => {
  it("takes as the main tab only Perplexity's main page, by the one rule", async () => {
    vi.spyOn(client, "listTargets").mockResolvedValue(
      listed(
        LOOKALIKE_TAB,
        SIDECAR_TAB,
        SIDECAR_NAMED_THREAD,
        MAIN_TAB,
        USER_TAB,
      ),
    );

    expect((await client.listTabsCategorized()).main?.id).toBe(
      SIDECAR_NAMED_THREAD.id,
    );
  });

  it("has no main tab when only the sidecar and a user's page are open", async () => {
    vi.spyOn(client, "listTargets").mockResolvedValue(
      listed(SIDECAR_TAB, LOOKALIKE_TAB),
    );

    expect((await client.listTabsCategorized()).main).toBeNull();
  });
});
