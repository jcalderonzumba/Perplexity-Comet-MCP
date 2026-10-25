/**
 * One WebSocket to Comet's browser, and the tabs reached through it.
 *
 * Tabs are listed, opened and closed through the protocol's `Target` domain,
 * and each tab the client drives is a session attached on the same socket,
 * so moving between tabs never opens another one. The address is built here
 * from a port and a path only `parseBrowserPath` makes, always on
 * `127.0.0.1` (principle 4).
 *
 * A session binds the client's own domain methods to its session id without
 * naming any of them, so every page script still runs from a visible
 * `Runtime.evaluate` call site in `src/cdp-client.ts` (boundary 3).
 */

import CDP from "chrome-remote-interface";
import type { CDPTarget } from "./types.js";

declare const parsed: unique symbol;

/** The path of a browser WebSocket, `/devtools/browser/<uuid>`. */
export type BrowserPath = string & { readonly [parsed]: "browser path" };

const BROWSER_PATH =
  /^\/devtools\/browser\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `raw` as a browser path when it is exactly one, else null. */
export function parseBrowserPath(raw: string): BrowserPath | null {
  return BROWSER_PATH.test(raw) ? (raw as BrowserPath) : null;
}

/** Where Comet's browser WebSocket listens on `127.0.0.1`. */
export interface BrowserEndpoint {
  readonly port: number;
  readonly path: BrowserPath;
}

type PageDomainName =
  | "Page"
  | "Runtime"
  | "DOM"
  | "Input"
  | "Emulation"
  | "Network";

/** The page domains the client drives a tab with. */
export type PageDomains = Pick<CDP.Client, PageDomainName>;

/** A tab attached on the browser connection, its session id bound. */
export interface PageSession extends PageDomains {
  readonly targetId: string;
  /** Whether the browser ended the session: its tab closed or went away. */
  readonly lost: boolean;
  /** Calls `listener` once, when the browser ends the session. */
  onLost(listener: () => void): void;
  /** Ends the session, leaving the connection open. */
  detach(): Promise<void>;
}

/** A protocol member as `chrome-remote-interface` decorates it. */
type ProtocolMember = ((...args: unknown[]) => unknown) & {
  readonly category?: string;
};

/**
 * `domain` with every command sending `sessionId` and every event listening
 * to `sessionId` only; anything else the library adds is left out, so no
 * path reaches the domain without the session.
 */
function bindToSession<T extends object>(domain: T, sessionId: string): T {
  return new Proxy(domain, {
    get(target, name) {
      const member: unknown = Reflect.get(target, name);
      if (typeof member !== "function") return member;
      const { category } = member as ProtocolMember;
      if (category === "command") {
        return (params?: unknown) => member(params, sessionId);
      }
      if (category === "event") {
        return (listener?: unknown) => member(sessionId, listener);
      }
      return undefined;
    },
  });
}

class AttachedSession implements PageSession {
  readonly Page: PageDomains["Page"];
  readonly Runtime: PageDomains["Runtime"];
  readonly DOM: PageDomains["DOM"];
  readonly Input: PageDomains["Input"];
  readonly Emulation: PageDomains["Emulation"];
  readonly Network: PageDomains["Network"];
  private ended = false;
  private wasLost = false;
  private readonly lostListeners: Array<() => void> = [];

  constructor(
    client: CDP.Client,
    sessionId: string,
    readonly targetId: string,
    private readonly end: () => Promise<void>,
  ) {
    this.Page = bindToSession(client.Page, sessionId);
    this.Runtime = bindToSession(client.Runtime, sessionId);
    this.DOM = bindToSession(client.DOM, sessionId);
    this.Input = bindToSession(client.Input, sessionId);
    this.Emulation = bindToSession(client.Emulation, sessionId);
    this.Network = bindToSession(client.Network, sessionId);
  }

  get lost(): boolean {
    return this.wasLost;
  }

  onLost(listener: () => void): void {
    this.lostListeners.push(listener);
  }

  markLost(): void {
    if (this.ended) return;
    this.ended = true;
    this.wasLost = true;
    for (const listener of this.lostListeners) listener();
  }

  async detach(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    await this.end();
  }
}

export class BrowserConnection {
  /** The attached sessions the browser has not ended, by session id. */
  private readonly sessions = new Map<string, AttachedSession>();

  private constructor(private readonly client: CDP.Client) {
    client.Target.detachedFromTarget(({ sessionId }) => {
      this.lose(sessionId);
    });
    client.Target.targetDestroyed(({ targetId }) => {
      for (const [sessionId, session] of this.sessions) {
        if (session.targetId === targetId) this.lose(sessionId);
      }
    });
  }

  /** Opens the one socket to the browser at `endpoint`. */
  static async open(endpoint: BrowserEndpoint): Promise<BrowserConnection> {
    const { port, path } = endpoint;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid browser port: ${port}`);
    }
    const client = await CDP({
      target: `ws://127.0.0.1:${port}${path}`,
      local: true,
    });
    const connection = new BrowserConnection(client);
    await client.Target.setDiscoverTargets({ discover: true });
    return connection;
  }

  async targets(): Promise<CDPTarget[]> {
    const { targetInfos } = await this.client.Target.getTargets();
    return targetInfos.map(({ targetId, type, title, url }) => ({
      id: targetId,
      type,
      title,
      url,
    }));
  }

  async createTarget(url: string): Promise<CDPTarget> {
    const { targetId } = await this.client.Target.createTarget({ url });
    return { id: targetId, type: "page", title: "", url: url || "about:blank" };
  }

  async closeTarget(targetId: string): Promise<boolean> {
    const { success } = await this.client.Target.closeTarget({ targetId });
    return success;
  }

  async attach(targetId: string): Promise<PageSession> {
    const { sessionId } = await this.client.Target.attachToTarget({
      targetId,
      flatten: true,
    });
    const session = new AttachedSession(this.client, sessionId, targetId, () =>
      this.detach(sessionId),
    );
    this.sessions.set(sessionId, session);
    return session;
  }

  /** Calls `listener` when Comet drops the socket; `close()` does not. */
  onClose(listener: () => void): void {
    this.client.on("disconnect", listener);
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  private async detach(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    await this.client.Target.detachFromTarget({ sessionId });
  }

  private lose(sessionId: string): void {
    this.sessions.get(sessionId)?.markLost();
    this.sessions.delete(sessionId);
  }
}
