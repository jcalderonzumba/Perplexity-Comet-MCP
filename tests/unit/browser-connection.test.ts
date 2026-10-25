import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserConnection } from "../../src/browser-connection.js";
import {
  type BrowserEndpoint,
  parseBrowserPath,
} from "../../src/core/browser-endpoint.js";
import { FakeBrowser, type FakeBrowserSocket } from "./fakes/fake-browser.js";

// `BrowserConnection.open` opens its socket through `chrome-remote-interface`;
// the tests hand it a fake browser instead, which counts the sockets.
const cdp = vi.hoisted(() => ({
  browser: null as unknown as { open(options: unknown): unknown },
}));

vi.mock("chrome-remote-interface", () => ({
  default: async (options: unknown) => cdp.browser.open(options),
}));

const UUID = "0f1e2d3c-4b5a-6978-8a9b-acbdcedf0102";
const BROWSER_PATH = `/devtools/browser/${UUID}`;

let browser: FakeBrowser;

beforeEach(() => {
  browser = new FakeBrowser();
  browser.addTab({
    id: "tab-1",
    type: "page",
    title: "Perplexity",
    url: "https://www.perplexity.ai/",
  });
  browser.addTab({
    id: "tab-2",
    type: "page",
    title: "News",
    url: "https://news.example/",
  });
  cdp.browser = browser;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function endpoint(port = 9222): BrowserEndpoint {
  const path = parseBrowserPath(BROWSER_PATH);
  if (!path) throw new Error("the test's path does not parse");
  return { port, path };
}

/** Opens a connection on the fake browser, and the one socket it opened. */
async function opened(): Promise<{
  connection: BrowserConnection;
  socket: FakeBrowserSocket;
}> {
  const connection = await BrowserConnection.open(endpoint());
  const [socket] = browser.sockets;
  if (!socket) throw new Error("no socket was opened");
  return { connection, socket };
}

describe("BrowserConnection.open", () => {
  it("opens exactly one socket, to the browser path on 127.0.0.1, with the local protocol", async () => {
    await opened();

    expect(browser.sockets).toHaveLength(1);
    expect(browser.sockets[0]?.options).toEqual({
      target: `ws://127.0.0.1:9222${BROWSER_PATH}`,
      local: true,
    });
  });

  it.each([0, 65536, 92.5, Number.NaN])(
    "refuses port %s before opening any socket",
    async (port) => {
      await expect(BrowserConnection.open(endpoint(port))).rejects.toThrow(
        "port",
      );
      expect(browser.sockets).toHaveLength(0);
    },
  );
});

describe("the Target domain", () => {
  it("lists the tabs through Target.getTargets", async () => {
    const { connection, socket } = await opened();

    expect(await connection.targets()).toEqual([
      {
        id: "tab-1",
        type: "page",
        title: "Perplexity",
        url: "https://www.perplexity.ai/",
      },
      {
        id: "tab-2",
        type: "page",
        title: "News",
        url: "https://news.example/",
      },
    ]);
    expect(socket.commands.at(-1)?.method).toBe("Target.getTargets");
  });

  it("opens a tab through Target.createTarget, as a page at the address asked for", async () => {
    const { connection, socket } = await opened();

    const tab = await connection.createTarget("https://example.com/");

    expect(socket.commands.at(-1)).toEqual({
      method: "Target.createTarget",
      params: { url: "https://example.com/" },
      sessionId: undefined,
    });
    expect(tab).toEqual({
      id: "created-1",
      type: "page",
      title: "",
      url: "https://example.com/",
    });
  });

  it("gives a tab opened with an empty address as about:blank", async () => {
    const { connection } = await opened();

    expect((await connection.createTarget("")).url).toBe("about:blank");
  });

  it("closes a tab through Target.closeTarget", async () => {
    const { connection, socket } = await opened();

    expect(await connection.closeTarget("tab-2")).toBe(true);
    expect(socket.commands.at(-1)).toEqual({
      method: "Target.closeTarget",
      params: { targetId: "tab-2" },
      sessionId: undefined,
    });
    expect(browser.hasTab("tab-2")).toBe(false);
  });

  it("sets the bounds of a tab's window through the browser's own domain, with no session", async () => {
    const { connection, socket } = await opened();
    const bounds = { width: 1440, height: 900, windowState: "normal" } as const;

    await connection.setWindowBounds("tab-2", bounds);

    expect(socket.commands.slice(-2)).toEqual([
      {
        method: "Browser.getWindowForTarget",
        params: { targetId: "tab-2" },
        sessionId: undefined,
      },
      {
        method: "Browser.setWindowBounds",
        params: { windowId: socket.windowOf("tab-2"), bounds },
        sessionId: undefined,
      },
    ]);
  });

  it("makes no HTTP request and opens no other socket for any of them", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const { connection } = await opened();

    await connection.targets();
    const tab = await connection.createTarget("");
    await connection.closeTarget(tab.id);

    expect(fetch).not.toHaveBeenCalled();
    expect(browser.sockets).toHaveLength(1);
  });
});

describe("attached sessions", () => {
  it("attaches in flat mode, so each command carries the session id", async () => {
    const { connection, socket } = await opened();

    const session = await connection.attach("tab-1");

    expect(socket.commands.at(-1)).toEqual({
      method: "Target.attachToTarget",
      params: { targetId: "tab-1", flatten: true },
      sessionId: undefined,
    });
    expect(session.targetId).toBe("tab-1");
  });

  it("sends each session's page commands with its own session id only", async () => {
    browser.addTab(
      { id: "tab-3", type: "page", title: "", url: "https://a.example/" },
      {
        Page: { getFrameTree: () => ({ frameTree: { frame: { id: "f3" } } }) },
      },
    );
    const { connection, socket } = await opened();
    const first = await connection.attach("tab-1");
    const second = await connection.attach("tab-3");
    const sessionOf = (method: string) =>
      socket.commands.find((command) => command.method === method)?.sessionId;
    const [firstId] = socket.sessionsOn("tab-1");
    const [secondId] = socket.sessionsOn("tab-3");

    await first.Runtime.enable();
    await first.Input.insertText({ text: "hi" });
    const tree = await second.Page.getFrameTree();
    await second.DOM.enable();

    expect(sessionOf("Runtime.enable")).toBe(firstId);
    expect(sessionOf("Input.insertText")).toBe(firstId);
    expect(sessionOf("Page.getFrameTree")).toBe(secondId);
    expect(sessionOf("DOM.enable")).toBe(secondId);
    expect(firstId).not.toBe(secondId);
    expect(tree).toEqual({ frameTree: { frame: { id: "f3" } } });
  });

  it("delivers each session's page events to its own listeners only", async () => {
    const { connection, socket } = await opened();
    const first = await connection.attach("tab-1");
    const second = await connection.attach("tab-2");
    const [firstId] = socket.sessionsOn("tab-1");
    const [secondId] = socket.sessionsOn("tab-2");
    const heardByFirst = vi.fn();
    const heardBySecond = vi.fn();
    first.Page.lifecycleEvent(heardByFirst);
    second.Page.lifecycleEvent(heardBySecond);

    socket.emit("Page.lifecycleEvent", { name: "load" }, firstId);

    expect(heardByFirst).toHaveBeenCalledOnce();
    expect(heardByFirst.mock.calls[0]?.[0]).toEqual({ name: "load" });
    expect(heardBySecond).not.toHaveBeenCalled();

    socket.emit("Page.lifecycleEvent", { name: "load" }, secondId);

    expect(heardByFirst).toHaveBeenCalledOnce();
    expect(heardBySecond).toHaveBeenCalledOnce();
  });

  it("stops a page event listener when it unsubscribes", async () => {
    const { connection, socket } = await opened();
    const session = await connection.attach("tab-1");
    const [sessionId] = socket.sessionsOn("tab-1");
    const heard = vi.fn();
    const unsubscribe = session.Page.lifecycleEvent(heard);

    unsubscribe();
    socket.emit("Page.lifecycleEvent", { name: "load" }, sessionId);

    expect(heard).not.toHaveBeenCalled();
  });

  it("ends one session on detach, keeping the socket and the other session", async () => {
    const { connection, socket } = await opened();
    const first = await connection.attach("tab-1");
    const second = await connection.attach("tab-2");
    const [firstId] = socket.sessionsOn("tab-1");
    const lost = vi.fn();
    first.onLost(lost);

    await first.detach();
    await second.Page.enable();

    expect(socket.commands).toContainEqual({
      method: "Target.detachFromTarget",
      params: { sessionId: firstId },
      sessionId: undefined,
    });
    expect(socket.closed).toBe(false);
    expect(socket.commands.at(-1)?.method).toBe("Page.enable");
    expect(first.lost).toBe(false);
    expect(lost).not.toHaveBeenCalled();
  });
});

describe("a lost session", () => {
  it("turns target discovery on, so the browser reports a closed tab", async () => {
    const { socket } = await opened();

    expect(socket.discovering).toBe(true);
  });

  it("is marked lost when the browser detaches it", async () => {
    const { connection, socket } = await opened();
    const session = await connection.attach("tab-1");
    const [sessionId = ""] = socket.sessionsOn("tab-1");
    const lost = vi.fn();
    session.onLost(lost);

    socket.emitDetached(sessionId);

    expect(session.lost).toBe(true);
    expect(lost).toHaveBeenCalledOnce();
  });

  it("is marked lost when its tab is destroyed", async () => {
    const { connection, socket } = await opened();
    const session = await connection.attach("tab-1");

    socket.emitDestroyed("tab-1");

    expect(session.lost).toBe(true);
  });

  it("tells its owner once when its tab closes, detached then destroyed", async () => {
    const { connection } = await opened();
    const session = await connection.attach("tab-1");
    const lost = vi.fn();
    session.onLost(lost);

    browser.closeTab("tab-1");

    expect(lost).toHaveBeenCalledOnce();
  });

  it("is not changed by the same events for another tab", async () => {
    const { connection, socket } = await opened();
    const session = await connection.attach("tab-1");
    await connection.attach("tab-2");
    const [otherId = ""] = socket.sessionsOn("tab-2");
    const lost = vi.fn();
    session.onLost(lost);

    socket.emitDetached(otherId);
    socket.emitDestroyed("tab-2");

    expect(session.lost).toBe(false);
    expect(lost).not.toHaveBeenCalled();
  });

  it("rejects a command still pending when its tab closes, as a closed session", async () => {
    browser.addTab(
      { id: "tab-3", type: "page", title: "", url: "https://a.example/" },
      { Page: { navigate: () => new Promise(() => {}) } },
    );
    const { connection } = await opened();
    const session = await connection.attach("tab-3");
    const pending = session.Page.navigate({ url: "https://b.example/" });

    browser.closeTab("tab-3");

    await expect(pending).rejects.toThrow("Session closed");
  });

  it("rejects a command still pending when the client detaches the session, as a closed session", async () => {
    browser.addTab(
      { id: "tab-3", type: "page", title: "", url: "https://a.example/" },
      { Page: { navigate: () => new Promise(() => {}) } },
    );
    const { connection } = await opened();
    const session = await connection.attach("tab-3");
    const lost = vi.fn();
    session.onLost(lost);
    const pending = session.Page.navigate({ url: "https://b.example/" });

    await session.detach();

    await expect(pending).rejects.toThrow("Session closed");
    expect(session.lost).toBe(false);
    expect(lost).not.toHaveBeenCalled();
  });

  it("rejects a command sent after the client detached the session", async () => {
    const { connection } = await opened();
    const session = await connection.attach("tab-1");
    await session.detach();

    await expect(session.Page.enable()).rejects.toThrow("Session closed");
  });

  it("rejects a command sent after the session was lost", async () => {
    browser.addTab(
      { id: "tab-3", type: "page", title: "", url: "https://a.example/" },
      { Page: { navigate: () => new Promise(() => {}) } },
    );
    const { connection } = await opened();
    const session = await connection.attach("tab-3");
    browser.closeTab("tab-3");

    await expect(
      session.Page.navigate({ url: "https://b.example/" }),
    ).rejects.toThrow("Session closed");
  });

  it("sends nothing to the browser on detach", async () => {
    const { connection, socket } = await opened();
    const session = await connection.attach("tab-1");
    socket.emitDestroyed("tab-1");
    const sent = socket.commands.length;

    await session.detach();

    expect(socket.commands).toHaveLength(sent);
  });
});

describe("the socket", () => {
  it("tells onClose once when Comet drops it", async () => {
    const { connection, socket } = await opened();
    const closed = vi.fn();
    connection.onClose(closed);

    socket.drop();

    expect(closed).toHaveBeenCalledOnce();
  });

  it("closes on close(), which is not a drop", async () => {
    const { connection, socket } = await opened();
    const closed = vi.fn();
    connection.onClose(closed);

    await connection.close();

    expect(socket.closed).toBe(true);
    expect(closed).not.toHaveBeenCalled();
  });
});

describe("the fake browser socket", () => {
  it("refuses a page-domain command that carries no session id", async () => {
    const { socket } = await opened();

    await expect(socket.Page.enable()).rejects.toThrow("wasn't found");
  });
});
