import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALLOW_DIALOG_BOUND_MS } from "../../src/browser-connection.js";
import { CometCDPClient } from "../../src/cdp-client.js";
import { createCdpToolTable } from "../../src/cdp-tools.js";
import type { BrowserTarget } from "../../src/core/perplexity-tab.js";
import { FakeBrowser, type FakeDialog } from "./fakes/fake-browser.js";
import { FakeCdpConnection } from "./fakes/fake-cdp-connection.js";
import { endpointOn, FakeCometLaunch } from "./fakes/fake-comet-launch.js";
import { MAIN_TAB, USER_TAB } from "./fakes/fake-tab-port.js";

// Through Comet's remote-debugging switch, every new socket makes Comet ask
// the user to allow it: Deny fails the socket at once, and a dialog nobody
// answers never answers. The fake browser asks for every socket, and each
// test answers its dialog, or does not.
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

const REFUSED =
  "Comet refused remote debugging: its dialog was answered Deny. Call comet_connect to ask again, then click Allow in Comet.";
const ASKING =
  "Comet is asking to allow remote debugging: click Allow in Comet's dialog, then call the tool again.";

let browser: FakeBrowser;
let launch: FakeCometLaunch;
let client: CometCDPClient;

function open(tab: BrowserTarget): void {
  const page = new FakeCdpConnection();
  page.moveTo(tab.url);
  browser.addTab({ ...tab, title: "" }, page);
}

/** The dialog of the socket opened `index`th, once the client opened it. */
async function dialog(index = 0): Promise<FakeDialog> {
  await vi.advanceTimersByTimeAsync(0);
  const found = browser.dialogs[index];
  if (!found) throw new Error(`no dialog ${index} was opened`);
  return found;
}

/** Settles `promise` on its own, so a test can advance time past it. */
function settled<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ value }),
    (error: Error) => ({ error: error.message }),
  );
}

/** The tool table over the client, as the server composes it. */
function table() {
  return createCdpToolTable({
    client,
    comet: { agentBrowsingUrl: async () => "" },
    launch,
    quotePage: (text) => text,
    port: 9222,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  browser = new FakeBrowser();
  for (const tab of [MAIN_TAB, USER_TAB]) open(tab);
  browser.asking = true;
  cdp.browser = browser;
  launch = new FakeCometLaunch();
  launch.switchAt = endpointOn(9333);
  launch.processRunning = true;
  client = new CometCDPClient({ port: 9222, launch });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Comet's allow dialog, through the switch", () => {
  it("connects once the user allows it", async () => {
    const listing = client.listTargets();

    (await dialog()).allow();

    await expect(listing).resolves.toHaveLength(2);
    expect(browser.sockets).toHaveLength(1);
  });

  it("fails with the refusal words when the user denies it", async () => {
    const listing = settled(client.listTargets());

    (await dialog()).deny();

    expect(await listing).toEqual({ error: REFUSED });
  });

  it("remembers a refusal: the ask's recovery and three retries open no socket, and comet_connect opens exactly one", async () => {
    const tools = table();
    const first = settled(client.listTargets());
    (await dialog()).deny();
    await first;

    const ask = settled(tools.call("comet_ask", { prompt: "q" }));
    await vi.advanceTimersByTimeAsync(5000);
    const retries = [1, 2, 3].map(() =>
      settled(client.withAutoReconnect(() => client.pageAddress())),
    );
    await vi.advanceTimersByTimeAsync(5000);

    expect(await ask).toMatchObject({
      value: { isError: true, text: expect.stringContaining(REFUSED) },
    });
    expect(await Promise.all(retries)).toEqual([
      { error: REFUSED },
      { error: REFUSED },
      { error: REFUSED },
    ]);
    expect(browser.sockets).toHaveLength(1);

    const connecting = settled(tools.call("comet_connect", {}));
    (await dialog(1)).allow();
    await vi.advanceTimersByTimeAsync(5000);

    expect(await connecting).toMatchObject({
      value: {
        isError: false,
        text: expect.stringContaining("remote-debugging switch on port 9333"),
      },
    });
    expect(browser.sockets).toHaveLength(2);
  });

  it("fails with the waiting words at the bound, and keeps the socket pending", async () => {
    const listing = settled(client.listTargets());
    await dialog();

    await vi.advanceTimersByTimeAsync(ALLOW_DIALOG_BOUND_MS - 1);
    expect(browser.sockets[0]?.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await listing).toEqual({ error: ASKING });
    expect(browser.sockets[0]?.closed).toBe(false);
  });

  it("has a later call wait on the same socket, up to the bound again, and opens no other", async () => {
    const first = settled(client.listTargets());
    await vi.advanceTimersByTimeAsync(ALLOW_DIALOG_BOUND_MS);
    await first;

    const second = settled(client.listTargets());
    await vi.advanceTimersByTimeAsync(ALLOW_DIALOG_BOUND_MS);

    expect(await second).toEqual({ error: ASKING });
    expect(browser.sockets).toHaveLength(1);
  });

  it("lets the waiting call through when the user allows the pending socket", async () => {
    const first = settled(client.listTargets());
    await vi.advanceTimersByTimeAsync(ALLOW_DIALOG_BOUND_MS);
    await first;

    const second = client.listTargets();
    await vi.advanceTimersByTimeAsync(10_000);
    (await dialog()).allow();

    await expect(second).resolves.toHaveLength(2);
    expect(browser.sockets).toHaveLength(1);
  });

  it("remembers a refusal given after the bound", async () => {
    const first = settled(client.listTargets());
    await vi.advanceTimersByTimeAsync(ALLOW_DIALOG_BOUND_MS);
    await first;

    (await dialog()).deny();
    await vi.advanceTimersByTimeAsync(0);

    expect(await settled(client.listTargets())).toEqual({ error: REFUSED });
    expect(browser.sockets).toHaveLength(1);
  });

  it("has the next call use a socket allowed after every call returned", async () => {
    const first = settled(client.listTargets());
    await vi.advanceTimersByTimeAsync(ALLOW_DIALOG_BOUND_MS);
    await first;

    (await dialog()).allow();
    await vi.advanceTimersByTimeAsync(0);

    await expect(client.listTargets()).resolves.toHaveLength(2);
    expect(browser.sockets).toHaveLength(1);
  });

  it("gives two calls at once one socket and the same outcome", async () => {
    const both = Promise.all([
      settled(client.listTargets()),
      settled(client.listTargets()),
    ]);
    await vi.advanceTimersByTimeAsync(ALLOW_DIALOG_BOUND_MS);

    expect(await both).toEqual([{ error: ASKING }, { error: ASKING }]);
    expect(browser.sockets).toHaveLength(1);

    const again = Promise.all([client.listTargets(), client.listTargets()]);
    (await dialog()).allow();

    expect((await again).map((tabs) => tabs.length)).toEqual([2, 2]);
    expect(browser.sockets).toHaveLength(1);
  });

  it("fails a retried operation with the waiting words within one bound, opening no other socket", async () => {
    const operation = settled(
      client.withAutoReconnect(() => client.pageAddress()),
    );

    await vi.advanceTimersByTimeAsync(ALLOW_DIALOG_BOUND_MS + 1000);

    expect(await operation).toEqual({ error: ASKING });
    expect(browser.sockets).toHaveLength(1);
  });

  it("closes a socket left pending by disconnect() as soon as it opens, and keeps nothing of it", async () => {
    const first = settled(client.listTargets());
    await vi.advanceTimersByTimeAsync(ALLOW_DIALOG_BOUND_MS);
    await first;

    await client.disconnect();
    (await dialog()).allow();
    await vi.advanceTimersByTimeAsync(0);

    expect(browser.sockets[0]?.closed).toBe(true);
  });
});

describe("Comet's allow dialog, never through the flag", () => {
  beforeEach(() => {
    launch.answering = "Comet/140.0";
  });

  it("waits past the bound for a socket opened through the flag", async () => {
    const listing = client.listTargets();
    await vi.advanceTimersByTimeAsync(2 * ALLOW_DIALOG_BOUND_MS);

    (await dialog()).allow();

    await expect(listing).resolves.toHaveLength(2);
  });

  it("remembers no failure of a socket opened through the flag", async () => {
    const first = settled(client.listTargets());
    (await dialog()).deny();

    expect(await first).not.toEqual({ error: REFUSED });

    const second = client.listTargets();
    (await dialog(1)).allow();

    await expect(second).resolves.toHaveLength(2);
    expect(browser.sockets).toHaveLength(2);
  });
});
