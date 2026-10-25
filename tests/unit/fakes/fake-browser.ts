// A fake of Comet's browser as `chrome-remote-interface` reaches it over the
// browser WebSocket: the tabs, the Target domain, and the page domains of a
// tab reached through a session attached to it. A test's mock of
// `chrome-remote-interface` opens each socket through `open`, so the browser
// counts every socket the code under test opens and keeps the options it
// gave. Each socket records every command with the session id it carried and
// refuses a page-domain command that carries none, as the browser target
// does. Like the library, a socket emits each event under its name and,
// when it belongs to a session, under `<name>.<sessionId>` too, and marks
// every domain member with its `category`.

import type CDP from "chrome-remote-interface";

/** A command a socket received, with the session id it carried. */
export interface SentCommand {
  readonly method: string;
  readonly params: unknown;
  readonly sessionId: string | undefined;
}

/** A tab, as `Target.getTargets` describes it. */
export interface FakeTab {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly url: string;
}

type Listener = (params: unknown, sessionId?: string) => void;
type Handler = (params: unknown) => unknown;
type DomainHandlers = Record<string, Handler | undefined>;
/**
 * What a tab's page domains answer: an object holding, by domain name, an
 * object of handlers by method name, as `FakeCdpConnection` is.
 */
export type PageHandlers = object;

/** The product `Browser.getVersion` names. */
export const FAKE_PRODUCT = "Chrome/155.0.8059.148";

/** The page events a session can subscribe to; the rest are commands. */
const PAGE_EVENTS = new Set(["Page.lifecycleEvent"]);

function withCategory<T extends object>(
  category: "command" | "event",
  member: T,
): T {
  return Object.assign(member, { category });
}

export class FakeBrowser {
  readonly sockets: FakeBrowserSocket[] = [];
  private readonly tabs = new Map<
    string,
    { tab: FakeTab; page: PageHandlers }
  >();
  private created = 0;

  /** A browser with one tab, `id`, whose page answers through `page`. */
  static withTab(id: string, page: PageHandlers): FakeBrowser {
    const browser = new FakeBrowser();
    browser.addTab({ id, type: "page", title: "", url: "about:blank" }, page);
    return browser;
  }

  /** Opens a socket, as `CDP(options)` would. */
  open(options: CDP.Options): FakeBrowserSocket {
    const socket = new FakeBrowserSocket(this, options);
    this.sockets.push(socket);
    return socket;
  }

  /** Adds a tab whose page domains answer through `page`. */
  addTab(tab: FakeTab, page: PageHandlers = {}): void {
    this.tabs.set(tab.id, { tab, page });
  }

  tabList(): FakeTab[] {
    return [...this.tabs.values()].map(({ tab }) => tab);
  }

  hasTab(targetId: string): boolean {
    return this.tabs.has(targetId);
  }

  pageOf(targetId: string): PageHandlers {
    return this.tabs.get(targetId)?.page ?? {};
  }

  createTab(url: string): string {
    const id = `created-${++this.created}`;
    this.addTab({ id, type: "page", title: "", url: url || "about:blank" });
    return id;
  }

  /** Closes a tab, as the user or `Target.closeTarget` would. */
  closeTab(targetId: string): void {
    this.tabs.delete(targetId);
    for (const socket of this.sockets) socket.tabGone(targetId);
  }
}

export class FakeBrowserSocket {
  /** Every command received, in the order received. */
  readonly commands: SentCommand[] = [];
  closed = false;
  discovering = false;
  private readonly listeners = new Map<string, Listener[]>();
  /** The attached sessions, by session id, to the tab each is on. */
  private readonly sessions = new Map<string, string>();
  private attached = 0;

  readonly Target = {
    getTargets: this.command("Target.getTargets", () => ({
      targetInfos: this.browser.tabList().map((tab) => ({
        targetId: tab.id,
        type: tab.type,
        title: tab.title,
        url: tab.url,
        attached: false,
        canAccessOpener: false,
      })),
    })),
    createTarget: this.command("Target.createTarget", (params) => ({
      targetId: this.browser.createTab((params as { url: string }).url),
    })),
    closeTarget: this.command("Target.closeTarget", (params) => {
      const { targetId } = params as { targetId: string };
      if (!this.browser.hasTab(targetId)) {
        throw new Error("No target with given id found");
      }
      this.browser.closeTab(targetId);
      return { success: true };
    }),
    attachToTarget: this.command("Target.attachToTarget", (params) => {
      const { targetId } = params as { targetId: string };
      if (!this.browser.hasTab(targetId)) {
        throw new Error("No target with given id found");
      }
      const sessionId = `session-${++this.attached}`;
      this.sessions.set(sessionId, targetId);
      return { sessionId };
    }),
    detachFromTarget: this.command("Target.detachFromTarget", (params) => {
      const { sessionId } = params as { sessionId: string };
      const targetId = this.sessions.get(sessionId);
      if (!targetId) throw new Error("No session with given id");
      this.emitDetached(sessionId);
      return {};
    }),
    setDiscoverTargets: this.command("Target.setDiscoverTargets", (params) => {
      this.discovering = (params as { discover: boolean }).discover;
      return {};
    }),
    detachedFromTarget: this.event("Target.detachedFromTarget"),
    targetDestroyed: this.event("Target.targetDestroyed"),
  };

  readonly Browser = {
    getWindowForTarget: this.command("Browser.getWindowForTarget", (params) => {
      const { targetId } = params as { targetId: string };
      if (!this.browser.hasTab(targetId)) {
        throw new Error("No target with given id found");
      }
      return { windowId: this.windowOf(targetId) };
    }),
    setWindowBounds: this.command("Browser.setWindowBounds", () => ({})),
    getVersion: this.command("Browser.getVersion", () => ({
      protocolVersion: "1.3",
      product: FAKE_PRODUCT,
      revision: "@0",
      userAgent: "Mozilla/5.0",
      jsVersion: "15.5",
    })),
  };

  readonly Page = this.pageDomain("Page");
  readonly Runtime = this.pageDomain("Runtime");
  readonly DOM = this.pageDomain("DOM");
  readonly Input = this.pageDomain("Input");
  readonly Emulation = this.pageDomain("Emulation");
  readonly Network = this.pageDomain("Network");

  constructor(
    private readonly browser: FakeBrowser,
    readonly options: CDP.Options,
  ) {}

  on(event: string, listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  /** Closes the socket as the library's `close()` does: no `disconnect`. */
  async close(): Promise<void> {
    this.closed = true;
  }

  /** Drops the socket from Comet's side: the library emits `disconnect`. */
  drop(): void {
    this.closed = true;
    this.emit("disconnect", undefined);
  }

  /** Emits an event, as the library does for a message from the browser. */
  emit(method: string, params: unknown, sessionId?: string): void {
    for (const listener of this.listeners.get(method) ?? []) {
      listener(params, sessionId);
    }
    if (!sessionId) return;
    for (const listener of this.listeners.get(`${method}.${sessionId}`) ?? []) {
      listener(params, sessionId);
    }
  }

  /** Ends a session from the browser's side, as a closed or crashed tab does. */
  emitDetached(sessionId: string): void {
    const targetId = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    this.emit("Target.detachedFromTarget", { sessionId, targetId });
  }

  /** Reports a tab gone; heard only while target discovery is on. */
  emitDestroyed(targetId: string): void {
    if (this.discovering) this.emit("Target.targetDestroyed", { targetId });
  }

  /** The session ids attached to `targetId` now. */
  sessionsOn(targetId: string): string[] {
    return [...this.sessions]
      .filter(([, on]) => on === targetId)
      .map(([id]) => id);
  }

  /** The window `targetId` is in: one window per tab, numbered from 1. */
  windowOf(targetId: string): number {
    return this.browser.tabList().findIndex((tab) => tab.id === targetId) + 1;
  }

  tabGone(targetId: string): void {
    for (const sessionId of this.sessionsOn(targetId)) {
      this.emitDetached(sessionId);
    }
    this.emitDestroyed(targetId);
  }

  private command(method: string, answer: Handler) {
    return withCategory(
      "command",
      async (params?: unknown, sessionId?: string) => {
        this.commands.push({ method, params, sessionId });
        if (this.closed) throw new Error("WebSocket is not open");
        return answer(params);
      },
    );
  }

  private event(method: string) {
    return withCategory(
      "event",
      (sessionIdOrListener: string | Listener, listener?: Listener) => {
        const sessionId =
          typeof sessionIdOrListener === "string"
            ? sessionIdOrListener
            : undefined;
        const handler =
          typeof sessionIdOrListener === "function"
            ? sessionIdOrListener
            : listener;
        if (!handler) throw new Error("the fake takes listeners only");
        this.on(sessionId ? `${method}.${sessionId}` : method, handler);
        return () => {
          const name = sessionId ? `${method}.${sessionId}` : method;
          this.listeners.set(
            name,
            (this.listeners.get(name) ?? []).filter((l) => l !== handler),
          );
        };
      },
    );
  }

  /**
   * A page domain: each member is an event when `PAGE_EVENTS` names it, and
   * otherwise a command answered by the page of the session's tab.
   */
  private pageDomain(
    domain: string,
  ): Record<string, (first?: unknown, second?: unknown) => unknown> {
    return new Proxy(
      {},
      {
        get: (_target, name) => {
          if (typeof name !== "string") return undefined;
          const method = `${domain}.${name}`;
          return PAGE_EVENTS.has(method)
            ? this.event(method)
            : this.pageCommand(domain, name);
        },
      },
    );
  }

  private pageCommand(domain: string, name: string) {
    const method = `${domain}.${name}`;
    return withCategory(
      "command",
      async (params?: unknown, sessionId?: string) => {
        this.commands.push({ method, params, sessionId });
        if (this.closed) throw new Error("WebSocket is not open");
        const targetId = sessionId && this.sessions.get(sessionId);
        if (!targetId) throw new Error(`'${method}' wasn't found`);
        const page = this.browser.pageOf(targetId) as Record<
          string,
          DomainHandlers | undefined
        >;
        const handler = page[domain]?.[name];
        return handler ? handler(params) : {};
      },
    );
  }
}
