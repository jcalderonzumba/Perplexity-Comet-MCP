/**
 * One WebSocket to Comet's browser, and the tabs reached through it.
 *
 * Tabs are listed, opened and closed through the protocol's `Target` domain,
 * and each tab the client drives is a session attached on the same socket,
 * so moving between tabs never opens another one. The address is built here
 * from a port and a path only `parseBrowserPath` (`core/browser-endpoint.ts`)
 * makes, always on `127.0.0.1` (principle 4).
 *
 * A session binds the client's own domain methods to its session id without
 * naming any of them, so every page script still runs from a visible
 * `Runtime.evaluate` call site in `src/cdp-client.ts` (boundary 3).
 *
 * Through Comet's remote-debugging switch, Comet asks the user to allow each
 * new socket: `AllowDialog` bounds that wait and remembers a refusal.
 */

import CDP from "chrome-remote-interface";
import type { BrowserEndpoint } from "./core/browser-endpoint.js";
import { RemoteDebuggingNotAllowed } from "./core/comet-launch.js";
import type { CDPTarget } from "./types.js";

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

/** A browser window's bounds, as `Browser.setWindowBounds` takes them. */
export type WindowBounds = Parameters<
  CDP.Client["Browser"]["setWindowBounds"]
>[0]["bounds"];

/** A protocol member as `chrome-remote-interface` decorates it. */
type ProtocolMember = ((...args: unknown[]) => unknown) & {
  readonly category?: string;
};

/**
 * `domain` with every command sending `sessionId` and every event listening
 * to `sessionId` only; anything else the library adds is left out, so no
 * path reaches the domain without the session. A command rejects when
 * `ending` does, so one the browser never answers cannot outlive the
 * session; `ending` races first, so it also wins for a session already ended.
 */
function bindToSession<T extends object>(
  domain: T,
  sessionId: string,
  ending: Promise<never>,
): T {
  return new Proxy(domain, {
    get(target, name) {
      const member: unknown = Reflect.get(target, name);
      if (typeof member !== "function") return member;
      const { category } = member as ProtocolMember;
      if (category === "command") {
        return (params?: unknown) =>
          Promise.race([ending, member(params, sessionId)]);
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
  private endCommands: () => void = () => {};

  constructor(
    client: CDP.Client,
    sessionId: string,
    readonly targetId: string,
    private readonly end: () => Promise<void>,
  ) {
    const ending = this.endingSignal();
    this.Page = bindToSession(client.Page, sessionId, ending);
    this.Runtime = bindToSession(client.Runtime, sessionId, ending);
    this.DOM = bindToSession(client.DOM, sessionId, ending);
    this.Input = bindToSession(client.Input, sessionId, ending);
    this.Emulation = bindToSession(client.Emulation, sessionId, ending);
    this.Network = bindToSession(client.Network, sessionId, ending);
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
    this.endCommands();
    for (const listener of this.lostListeners) listener();
  }

  async detach(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    this.endCommands();
    await this.end();
  }

  /**
   * Rejects when the session ends, by the browser or by `detach`, with text
   * the client's reconnect treats as a lost connection; no command waiting
   * is no error.
   */
  private endingSignal(): Promise<never> {
    const ending = new Promise<never>((_, reject) => {
      this.endCommands = () =>
        reject(new Error("Session closed: its tab was detached"));
    });
    ending.catch(() => {});
    return ending;
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

  /** The browser's product and version, as `Browser.getVersion` names it. */
  async version(): Promise<string> {
    return (await this.client.Browser.getVersion()).product;
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

  /** Sets the bounds of the window `targetId` is in, through the browser. */
  async setWindowBounds(targetId: string, bounds: WindowBounds): Promise<void> {
    const { windowId } = await this.client.Browser.getWindowForTarget({
      targetId,
    });
    await this.client.Browser.setWindowBounds({ windowId, bounds });
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

/**
 * How long a call waits for the user to answer Comet's allow dialog: under
 * the MCP TypeScript SDK's 60 s default request timeout, so the user gets
 * the server's words rather than the client's timeout.
 */
export const ALLOW_DIALOG_BOUND_MS = 30_000;

/**
 * Comet's allow-remote-debugging dialog, which every socket opened through
 * its switch puts on the user's screen. Deny fails the socket at once, and
 * the refusal is remembered until `askAgain`. A dialog nobody answers never
 * answers, so a call waits up to the bound, and the socket stays pending for
 * the calls after it: closing it would leave the dialog on screen, and a new
 * socket would open a second one. No call opens a socket while one is
 * pending; whatever the user answers later is recorded, whether or not a
 * call is waiting.
 */
export class AllowDialog {
  private refused = false;
  private pending: Promise<BrowserConnection> | null = null;

  /** `allowed` takes each connection the user allows. */
  constructor(
    private readonly allowed: (connection: BrowserConnection) => void,
  ) {}

  /** Forgets a refusal, so the next socket asks the user again. */
  askAgain(): void {
    this.refused = false;
  }

  /**
   * The connection to `endpoint` once the user allows it, through the
   * socket pending if there is one, else a new one; waits up to the bound.
   */
  open(endpoint: BrowserEndpoint): Promise<BrowserConnection> {
    if (this.refused) {
      return Promise.reject(RemoteDebuggingNotAllowed.refused());
    }
    this.pending ??= this.ask(endpoint);
    return withinBound(this.pending);
  }

  /** Leaves the socket pending: closed as soon as it opens, and forgotten. */
  abandon(): void {
    this.pending = null;
  }

  private ask(endpoint: BrowserEndpoint): Promise<BrowserConnection> {
    const answer: Promise<BrowserConnection> = BrowserConnection.open(
      endpoint,
    ).then(
      (connection) => this.answeredAllow(answer, connection),
      () => this.answeredDeny(answer),
    );
    return answer;
  }

  private answeredAllow(
    answer: Promise<BrowserConnection>,
    connection: BrowserConnection,
  ): BrowserConnection {
    if (this.pending !== answer) {
      connection.close().catch(() => {});
      throw new Error("The server closed its connection to Comet");
    }
    this.pending = null;
    this.allowed(connection);
    return connection;
  }

  private answeredDeny(answer: Promise<BrowserConnection>): never {
    if (this.pending === answer) {
      this.pending = null;
      this.refused = true;
    }
    throw RemoteDebuggingNotAllowed.refused();
  }
}

/** `answer`, or the dialog's waiting words once the bound has passed. */
function withinBound(
  answer: Promise<BrowserConnection>,
): Promise<BrowserConnection> {
  let timer: NodeJS.Timeout | undefined;
  const bound = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(RemoteDebuggingNotAllowed.asking()),
      ALLOW_DIALOG_BOUND_MS,
    );
  });
  return Promise.race([answer, bound]).finally(() => clearTimeout(timer));
}
