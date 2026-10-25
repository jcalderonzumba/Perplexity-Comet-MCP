import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CometCDPClient } from "../../src/cdp-client.js";
import type { BrowserTarget } from "../../src/core/perplexity-tab.js";
import { FakeBrowser } from "./fakes/fake-browser.js";
import { FakeCdpConnection } from "./fakes/fake-cdp-connection.js";
import {
  answeringLaunch,
  FAKE_BROWSER_PATH,
  type FakeCometLaunch,
} from "./fakes/fake-comet-launch.js";
import { LOOKALIKE_TAB, MAIN_TAB, USER_TAB } from "./fakes/fake-tab-port.js";

// The client holds one socket to the browser and drives the connected tab
// through a session attached on it. `chrome-remote-interface` opens each
// socket on the fake browser, which counts them.
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

let browser: FakeBrowser;
let launch: FakeCometLaunch;
let client: CometCDPClient;

/** Adds `tab` to the fake browser, its top frame at its address. */
function open(tab: BrowserTarget): void {
  const page = new FakeCdpConnection();
  page.moveTo(tab.url);
  browser.addTab({ ...tab, title: "" }, page);
}

/** The one socket opened so far. */
function firstSocket() {
  const [socket] = browser.sockets;
  if (!socket) throw new Error("no socket was opened");
  return socket;
}

beforeEach(() => {
  browser = new FakeBrowser();
  for (const tab of [MAIN_TAB, USER_TAB, LOOKALIKE_TAB]) open(tab);
  cdp.browser = browser;
  launch = answeringLaunch();
  client = new CometCDPClient({ port: 9222, launch });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CometCDPClient on one browser connection", () => {
  it("opens one socket, to the browser socket the probe found on 127.0.0.1, however often the connection moves", async () => {
    await client.connect(MAIN_TAB.id);
    await client.connect(USER_TAB.id);
    await client.connect(LOOKALIKE_TAB.id);

    expect(browser.sockets).toHaveLength(1);
    expect(firstSocket().options).toEqual({
      target: `ws://127.0.0.1:9222${FAKE_BROWSER_PATH}`,
      local: true,
    });
    expect(client.connectedTabId()).toBe(LOOKALIKE_TAB.id);
  });

  it("keeps one session attached: a move detaches the previous tab's", async () => {
    await client.connect(MAIN_TAB.id);
    await client.connect(USER_TAB.id);

    expect(firstSocket().sessionsOn(MAIN_TAB.id)).toEqual([]);
    expect(firstSocket().sessionsOn(USER_TAB.id)).toHaveLength(1);
  });

  it("drives the connected tab through its own session", async () => {
    await client.connect(USER_TAB.id);
    const [sessionId] = firstSocket().sessionsOn(USER_TAB.id);

    expect(await client.pageAddress()).toBe(USER_TAB.url);
    expect(firstSocket().commands.at(-1)).toEqual({
      method: "Page.getFrameTree",
      params: undefined,
      sessionId,
    });
  });

  it("never closes the socket when it moves to another tab; disconnect() closes it", async () => {
    await client.connect(MAIN_TAB.id);
    await client.connect(USER_TAB.id);

    expect(firstSocket().closed).toBe(false);

    await client.disconnect();

    expect(firstSocket().closed).toBe(true);
    expect(client.connectedTabId()).toBeNull();
  });

  it("sizes the connected tab's window through the browser, as before", async () => {
    await client.connect(USER_TAB.id);

    expect(firstSocket().commands).toContainEqual({
      method: "Browser.setWindowBounds",
      params: {
        windowId: firstSocket().windowOf(USER_TAB.id),
        bounds: { width: 1440, height: 900, windowState: "normal" },
      },
      sessionId: undefined,
    });
  });

  it("lists, opens and closes tabs through the Target domain on the same socket", async () => {
    const listed = await client.listTargets();
    const opened = await client.newTab("https://www.perplexity.ai/");
    const closed = await client.closeTab(opened.id);

    expect(listed.map((tab) => tab.id)).toEqual([
      MAIN_TAB.id,
      USER_TAB.id,
      LOOKALIKE_TAB.id,
    ]);
    expect(opened.url).toBe("https://www.perplexity.ai/");
    expect(closed).toBe(true);
    expect(firstSocket().commands.map((command) => command.method)).toEqual([
      "Target.setDiscoverTargets",
      "Target.getTargets",
      "Target.createTarget",
      "Target.closeTarget",
    ]);
    expect(browser.sockets).toHaveLength(1);
  });

  it("answers false when the tab to close is not there", async () => {
    expect(await client.closeTab("gone")).toBe(false);
  });

  it("fails naming the port when Comet does not answer there, and opens no socket", async () => {
    launch.answering = null;

    await expect(client.listTargets()).rejects.toThrow("9222");
    expect(browser.sockets).toHaveLength(0);
  });
});

describe("CometCDPClient when the connected tab closes", () => {
  it("re-attaches to the main page on the same socket before the next operation runs, from the browser's events alone", async () => {
    vi.useFakeTimers();
    await client.connect(USER_TAB.id);
    // A health check passed just now, so only the browser's events can tell
    // the client that the tab went away.
    const warmup = client.withAutoReconnect(() => client.pageAddress());
    await vi.advanceTimersByTimeAsync(0);
    await expect(warmup).resolves.toBe(USER_TAB.url);
    const operation = vi.fn(() => client.pageAddress());

    browser.closeTab(USER_TAB.id);
    const address = client.withAutoReconnect(operation);
    await vi.advanceTimersByTimeAsync(5000);

    await expect(address).resolves.toBe(MAIN_TAB.url);
    expect(operation).toHaveBeenCalledOnce();
    expect(client.connectedTabId()).toBe(MAIN_TAB.id);
    expect(browser.sockets).toHaveLength(1);
  });
});

describe("CometCDPClient when Comet drops the socket", () => {
  it("opens exactly one new socket for three operations at once", async () => {
    vi.useFakeTimers();
    await client.connect(MAIN_TAB.id);

    firstSocket().drop();
    const addresses = Promise.all(
      [1, 2, 3].map(() => client.withAutoReconnect(() => client.pageAddress())),
    );
    await vi.advanceTimersByTimeAsync(5000);

    await expect(addresses).resolves.toEqual([
      MAIN_TAB.url,
      MAIN_TAB.url,
      MAIN_TAB.url,
    ]);
    expect(browser.sockets).toHaveLength(2);
    expect(launch.launches).toEqual([]);
  });
});
