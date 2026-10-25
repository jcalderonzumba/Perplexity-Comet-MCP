// CDP Client wrapper for Comet browser control
// Modified for Windows/WSL support

import CDP from "chrome-remote-interface";
import { BrowserConnection, type PageSession } from "./browser-connection.js";
import { systemCometLaunch } from "./comet-launch.js";
import type { BrowserEndpoint } from "./core/browser-endpoint.js";
import {
  type CometLaunch,
  CometRunsWithoutPort,
  ensureCometOnPort,
  findCometOnPort,
} from "./core/comet-launch.js";
import { isBrowsingTab } from "./core/tabs.js";
import { errorMessage } from "./error-message.js";
import { IS_WSL } from "./host-platform.js";
import type { PagePoint } from "./page-scripts.js";
import {
  isPerplexityAddress,
  isPerplexityMainPage,
  PERPLEXITY_ORIGIN,
} from "./perplexity-pages.js";
import type {
  CDPTarget,
  CometState,
  EvaluateResult,
  NavigateResult,
  ScreenshotResult,
} from "./types.js";
import type {
  ValidatedSelector,
  ValidatedUploadPath,
} from "./upload-validator.js";

// chrome-remote-interface@^0.34.0 exposes `ProtocolError` at runtime
// (`module.exports.ProtocolError = ...`), but @types/chrome-remote-interface
// doesn't declare it yet. Cast at import so `instanceof` typechecks; remove
// the cast once DefinitelyTyped/DefinitelyTyped#74992 lands and we pick up
// the updated @types.
interface CdpProtocolError extends Error {
  request: { method: string; params?: unknown };
  response: CDP.SendError;
}
const ProtocolError = (
  CDP as unknown as {
    ProtocolError: new (...args: unknown[]) => CdpProtocolError;
  }
).ProtocolError;

// Hidden targets (e.g. the Perplexity sidecar panel) can report a 0x0 layout
// viewport in some Comet window states (cold launch, no real browsing tabs in
// front). When that happens, Page.captureScreenshot waits for compositor
// frames that never arrive and stalls for ~2 minutes. Detecting that state
// via Page.getLayoutMetrics() and supplying an explicit clip +
// captureBeyondViewport=true makes the renderer produce a frame immediately.
//
// The predicate is intentionally tight: both dimensions must be zero. Live
// CDP testing confirmed that 0x0 is the only reproducible viewport state
// that triggers the stall — Chromium's Emulation.setDeviceMetricsOverride
// rejects single-zero dimensions and falls back to the natural viewport,
// and the natural 0x0 case is "no layout computed yet" (an all-or-nothing
// state). A 0xN or Nx0 viewport is not a state we can observe in practice.
const SCREENSHOT_FALLBACK_CLIP = {
  x: 0,
  y: 0,
  width: 1280,
  height: 800,
  scale: 1,
} as const;

/**
 * The slice of the CDP Page domain that `captureScreenshotWithFallback` uses.
 * Lets unit tests substitute a hand-written fake without dragging in the full
 * `chrome-remote-interface` Page surface.
 */
export interface ScreenshotPageAPI {
  bringToFront(): Promise<unknown>;
  getLayoutMetrics(): Promise<{
    cssLayoutViewport?: { clientWidth: number; clientHeight: number };
    layoutViewport?: { clientWidth: number; clientHeight: number };
  }>;
  captureScreenshot(opts: {
    format: "png" | "jpeg";
    captureBeyondViewport?: boolean;
    clip?: typeof SCREENSHOT_FALLBACK_CLIP;
  }): Promise<ScreenshotResult>;
}

/**
 * Capture a screenshot, falling back to an explicit clip when the layout
 * viewport is degenerate. Extracted as a free function so it can be unit
 * tested against a fake Page without a live CDP connection.
 */
export async function captureScreenshotWithFallback(
  page: ScreenshotPageAPI,
  format: "png" | "jpeg" = "png",
): Promise<ScreenshotResult> {
  try {
    await page.bringToFront();
  } catch {
    /* not all targets support it */
  }

  let clip: typeof SCREENSHOT_FALLBACK_CLIP | undefined;
  try {
    const metrics = await page.getLayoutMetrics();
    const v = metrics.cssLayoutViewport ?? metrics.layoutViewport;
    if (!v?.clientWidth && !v?.clientHeight) {
      clip = SCREENSHOT_FALLBACK_CLIP;
    }
  } catch (err) {
    // Chrome-side rejection (e.g. method unsupported on a non-page target):
    // apply the fallback so captureScreenshot can still produce a frame.
    // Anything else (websocket dropped, unexpected throw): propagate — the
    // next CDP call would fail the same way, and masking with a synthetic
    // 1280x800 capture would hide a real transport-level failure.
    if (err instanceof ProtocolError) {
      clip = SCREENSHOT_FALLBACK_CLIP;
    } else {
      throw err;
    }
  }

  const result = await page.captureScreenshot({
    format,
    ...(clip ? { captureBeyondViewport: true, clip } : {}),
  });

  if (!result?.data) {
    throw new Error(
      "Screenshot returned empty data. Ensure you're connected to a visible tab with content.",
    );
  }

  return result;
}

/** Per-frame lifecycle accumulator: frameId -> { current loaderId, event names seen }. */
export type FrameLifecycleMap = Map<
  string,
  { loaderId: string; events: Set<string> }
>;

/** The handler `Page.lifecycleEvent` takes, typed by the CDP client. */
type LifecycleHandler = Parameters<CDP.Client["Page"]["lifecycleEvent"]>[0];

/**
 * The slice of the CDP Page domain that `waitForLifecycle` uses. The return
 * type of `lifecycleEvent(handler)` is CRI's unsubscribe function — api.js:49
 * returns `() => chrome.removeListener(rawEventName, handler)`.
 */
export interface LifecyclePageAPI {
  lifecycleEvent(handler: (params: { name?: string }) => void): () => unknown;
}

/**
 * Wait until any frame in `frameLifecycle` has fired the named
 * Page.lifecycleEvent (e.g. 'firstContentfulPaint', 'networkAlmostIdle').
 * Resolves true if the event is in the cache or arrives before the timeout;
 * false otherwise. Cleans up its listener and timer on every exit path.
 *
 * Defensive ordering: the listener is registered *before* scanning the
 * cache, so even if the event arrived on an I/O turn between calls it's
 * caught by the live listener rather than missed. Single-threaded JS makes
 * the synchronous-only path safe today, but the order matters if anything
 * upstream (CRI internals, scheduler) ever inserts a microtask here.
 *
 * Extracted as a free function so it can be unit tested against a fake
 * Page + map without a live CDP connection.
 */
export function waitForLifecycle(
  page: LifecyclePageAPI,
  frameLifecycle: FrameLifecycleMap,
  eventName: string,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let done = false;
    let unsubscribe: (() => unknown) | null = null;
    let timer: NodeJS.Timeout | null = null;
    const finish = (val: boolean) => {
      if (done) return;
      done = true;
      if (unsubscribe) {
        try {
          unsubscribe();
        } catch {
          /* ignore */
        }
      }
      if (timer) clearTimeout(timer);
      resolve(val);
    };
    const listener = (params: { name?: string }) => {
      if (params?.name === eventName) finish(true);
    };
    try {
      unsubscribe = page.lifecycleEvent(listener);
    } catch {
      finish(false);
      return;
    }
    for (const { events } of frameLifecycle.values()) {
      if (events.has(eventName)) {
        finish(true);
        return;
      }
    }
    timer = setTimeout(() => finish(false), timeoutMs);
  });
}

/** The parameters of the CDP `Input.dispatchMouseEvent` calls `clickAtPoint` sends. */
export interface MouseEventParams {
  type: "mouseMoved" | "mousePressed" | "mouseReleased";
  x: number;
  y: number;
  button?: "left";
  clickCount?: number;
}

/** The slice of the CDP Input domain that `clickAtPoint` uses. */
export interface MouseInputAPI {
  dispatchMouseEvent(params: MouseEventParams): Promise<unknown>;
}

/**
 * Click at `point`, in viewport CSS pixels, with real pointer events: move
 * there, then press and release the left button once. Some page controls
 * (Perplexity's mode menu among them) open only on pointer events, never on
 * a scripted `element.click()`.
 */
export async function clickAtPoint(
  input: MouseInputAPI,
  point: PagePoint,
): Promise<void> {
  const { x, y } = point;
  await input.dispatchMouseEvent({ type: "mouseMoved", x, y });
  const press = { x, y, button: "left", clickCount: 1 } as const;
  await input.dispatchMouseEvent({ type: "mousePressed", ...press });
  await input.dispatchMouseEvent({ type: "mouseReleased", ...press });
}

/** The slice of the CDP Page domain that reads the tab's top frame. */
export interface FrameTreeAPI {
  getFrameTree(): Promise<{
    frameTree: { frame: { url: string; securityOrigin: string } };
  }>;
}

/**
 * The security origin of the tab's top frame, as the browser reports it.
 * Read through CDP rather than page script, so a page cannot answer for
 * itself, and read afresh, since the tab can move without this client.
 */
export async function readTopFrameOrigin(page: FrameTreeAPI): Promise<string> {
  const { frameTree } = await page.getFrameTree();
  return frameTree.frame.securityOrigin;
}

/**
 * The address of the tab's top frame, as the browser reports it, read
 * afresh through CDP for the same reasons as its origin.
 */
export async function readTopFrameAddress(page: FrameTreeAPI): Promise<string> {
  const { frameTree } = await page.getFrameTree();
  return frameTree.frame.url;
}

/** A key the server presses. */
export type TrustedKey = "Enter" | "Escape";

/** The parameters of the CDP `Input.dispatchKeyEvent` calls `pressKeyOn` sends. */
export interface KeyEventParams {
  type: "keyDown" | "rawKeyDown" | "keyUp";
  key: TrustedKey;
  code: string;
  windowsVirtualKeyCode: number;
  text?: string;
  unmodifiedText?: string;
}

/** The slice of the CDP Input domain trusted input uses. */
export interface TrustedInputAPI extends MouseInputAPI {
  dispatchKeyEvent(params: KeyEventParams): Promise<unknown>;
  insertText(params: { text: string }): Promise<unknown>;
}

/** What a real key press carries for each key, as a US keyboard sends it. */
const KEY_CODES: Record<
  TrustedKey,
  { code: string; windowsVirtualKeyCode: number; text?: string }
> = {
  Enter: { code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Escape: { code: "Escape", windowsVirtualKeyCode: 27 },
};

/**
 * Refuses `action` unless the browser reports the tab's top frame on
 * Perplexity's origin. Every trusted input the server sends passes here,
 * and so does the focus emulation that lets it reach a tab behind other
 * windows: the origin is read through CDP, never page script, and read
 * immediately before the input, so a tab that navigated since the last one
 * gets nothing. An origin that cannot be read refuses the input. A refusal
 * names only Perplexity's origin, never the tab's: the site's operator
 * chooses that one, and the refusal reaches replies as the server's words.
 */
async function refuseOffPerplexity(
  page: FrameTreeAPI,
  action: string,
): Promise<void> {
  let origin: string;
  try {
    origin = await readTopFrameOrigin(page);
  } catch (error) {
    throw new Error(
      `refused to ${action}: the tab's origin could not be read (${errorMessage(error)})`,
    );
  }
  if (origin !== PERPLEXITY_ORIGIN) {
    throw new Error(
      `refused to ${action}: the tab is not on ${PERPLEXITY_ORIGIN}`,
    );
  }
}

/**
 * Press and release `key` with the codes a real key press carries; a key
 * that types text (Enter) sends it on the way down, as a keyboard does.
 */
async function pressKeyOn(
  input: TrustedInputAPI,
  key: TrustedKey,
): Promise<void> {
  const { text, ...codes } = KEY_CODES[key];
  const down = text
    ? ({ type: "keyDown", text, unmodifiedText: text } as const)
    : ({ type: "rawKeyDown" } as const);
  await input.dispatchKeyEvent({ ...down, key, ...codes });
  await input.dispatchKeyEvent({ type: "keyUp", key, ...codes });
}

// Check if WSL can directly connect to Windows localhost (mirrored networking)
async function canConnectToWindowsLocalhost(port: number): Promise<boolean> {
  if (!IS_WSL) return true;

  const net = await import("node:net");
  return new Promise((resolve) => {
    const client = net.createConnection({ port, host: "127.0.0.1" }, () => {
      client.destroy();
      resolve(true);
    });
    client.on("error", () => {
      resolve(false);
    });
    client.setTimeout(2000, () => {
      client.destroy();
      resolve(false);
    });
  });
}

// For WSL: port to use for CDP connection
async function getWSLConnectPort(targetPort: number): Promise<number> {
  if (!IS_WSL) return targetPort;

  // Check if mirrored networking is enabled (direct localhost access works)
  const canConnect = await canConnectToWindowsLocalhost(targetPort);
  if (canConnect) {
    return targetPort;
  }

  // Cannot connect - throw helpful error
  throw new Error(
    `WSL cannot connect to Windows localhost:${targetPort}.\n\n` +
      `To fix this, enable WSL mirrored networking:\n` +
      `1. Create/edit %USERPROFILE%\\.wslconfig with:\n` +
      `   [wsl2]\n` +
      `   networkingMode=mirrored\n` +
      `2. Run: wsl --shutdown\n` +
      `3. Restart WSL and try again\n\n` +
      `Alternatively, run Claude Code from Windows PowerShell instead of WSL.`,
  );
}

// Honour the documented `COMET_PORT` env var (see README "Environment Variables").
// Previously the constant was hardcoded to 9223 and call sites passed the literal
// straight to `startComet(9223)`, so the env var was silently ignored.
function readPortFromEnv(): number {
  const raw = process.env.COMET_PORT;
  if (!raw) return 9223;
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    console.error(`Invalid COMET_PORT="${raw}", falling back to 9223`);
    return 9223;
  }
  return n;
}
export const DEFAULT_PORT = readPortFromEnv();

export interface CometClientOptions {
  /** The debug port Comet answers on; defaults to the configured one. */
  readonly port?: number;
  /** How Comet is found and launched; defaults to this machine's. */
  readonly launch?: CometLaunch;
}

/** The tab a reconnect goes to among `targets`, by the one rule for the main page. */
function reconnectTarget(targets: readonly CDPTarget[]): CDPTarget | undefined {
  const pages = targets.filter((t) => t.type === "page");
  return (
    pages.find((t) => isPerplexityMainPage(t.url)) ??
    pages.find((t) => t.url !== "about:blank" && !isPerplexityAddress(t.url))
  );
}

/** The size the connected tab's window is given, for a consistent layout. */
const WINDOW_SIZE = { width: 1440, height: 900 } as const;

export class CometCDPClient {
  /** The one socket to Comet's browser; null until opened, or once dropped. */
  private connection: BrowserConnection | null = null;
  /** The opening of `connection`, which every caller meanwhile shares. */
  private opening: Promise<BrowserConnection> | null = null;
  /** The connected tab, attached on `connection`. */
  private session: PageSession | null = null;
  /**
   * How many callers hold focus emulation, per session: it is one on/off
   * switch per CDP session, so it ends only when its last holder stops.
   */
  private readonly focusHolders = new WeakMap<PageSession, number>();
  private readonly launch: CometLaunch;
  private state: CometState = {
    connected: false,
    port: DEFAULT_PORT,
  };
  private lastTargetId: string | undefined;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  // In-flight reconnect promise. Multiple concurrent operations entering
  // `withAutoReconnect` after a transport drop must NOT each kick off
  // their own reconnect — they would race on `this.session` (one detaches
  // while another is mid-attach), corrupting state. We cache the single
  // promise and let all waiters await it.
  private reconnectPromise: Promise<void> | null = null;
  // Consecutive successful operations since the last connection error.
  // Used to reset the attempt counter only after the connection has
  // proven stable, so a flapping link doesn't silently bypass the
  // max-attempts breaker.
  private consecutiveSuccesses: number = 0;
  private lastHealthCheck: number = 0;
  private healthCheckCache: boolean = false;
  private readonly HEALTH_CHECK_CACHE_MS: number = 2000; // Cache health check for 2s

  // Page lifecycle tracking — events accumulated per frame for the current
  // document (loaderId). Used by waitForLifecycle() so screenshots and other
  // ops can confirm the renderer has actually painted before they run.
  private frameLifecycle: FrameLifecycleMap = new Map();
  private lifecycleListener: LifecycleHandler | null = null;
  private lifecycleUnsubscribe: (() => unknown) | null = null;

  constructor(options: CometClientOptions = {}) {
    this.launch = options.launch ?? systemCometLaunch;
    this.state.port = options.port ?? DEFAULT_PORT;
  }

  get isConnected(): boolean {
    return this.state.connected && !this.needsReconnect();
  }

  get currentState(): CometState {
    return { ...this.state };
  }

  /**
   * Check if connection is healthy by testing a simple operation (cached)
   */
  async isConnectionHealthy(): Promise<boolean> {
    // Return cached result if recent
    const now = Date.now();
    if (now - this.lastHealthCheck < this.HEALTH_CHECK_CACHE_MS) {
      return this.healthCheckCache;
    }

    if (!this.session) {
      this.healthCheckCache = false;
      this.lastHealthCheck = now;
      return false;
    }

    try {
      await this.session.Runtime.evaluate({ expression: "1+1", timeout: 3000 });
      this.healthCheckCache = true;
      this.lastHealthCheck = now;
      return true;
    } catch {
      this.healthCheckCache = false;
      this.lastHealthCheck = now;
      return false;
    }
  }

  /**
   * Force invalidate health cache (call after known connection issues)
   */
  invalidateHealthCache(): void {
    this.lastHealthCheck = 0;
    this.healthCheckCache = false;
  }

  /**
   * Ensure connection is healthy, reconnect if not
   */
  async ensureConnection(): Promise<void> {
    if (!(await this.isConnectionHealthy())) {
      this.invalidateHealthCache();
      await this.reconnect();
    }
  }

  /**
   * Pre-operation check - ensures connection is valid before any operation
   * Call this before critical operations
   */
  async preOperationCheck(): Promise<void> {
    // No tab to drive, or its tab or the socket is gone: no health check
    // can pass, so reconnect first.
    if (this.needsReconnect()) {
      await this.ensureSingleReconnect();
      return;
    }

    // If we recently verified health, skip
    if (
      Date.now() - this.lastHealthCheck < this.HEALTH_CHECK_CACHE_MS &&
      this.healthCheckCache
    ) {
      return;
    }

    // Full health check
    if (!(await this.isConnectionHealthy())) {
      this.invalidateHealthCache();
      await this.ensureSingleReconnect();
    }
  }

  /**
   * Whether there is no tab to drive: none attached, the browser ended its
   * session (its tab closed or went away), or Comet dropped the socket.
   */
  private needsReconnect(): boolean {
    return (
      this.connection === null || this.session === null || this.session.lost
    );
  }

  /**
   * Auto-reconnect wrapper for operations with exponential backoff
   */
  /**
   * Coalesce concurrent reconnect attempts onto a single promise.
   * Any caller awaiting `ensureSingleReconnect()` either receives the
   * promise of an already-running reconnect or starts a fresh one.
   */
  private ensureSingleReconnect(): Promise<void> {
    if (!this.reconnectPromise) {
      const attempt = this.reconnectAttempts;
      const delay = Math.min(300 * 1.3 ** Math.max(attempt - 1, 0), 2000);
      this.reconnectPromise = (async () => {
        this.invalidateHealthCache();
        await new Promise((r) => setTimeout(r, delay));
        await this.reconnect();
      })().finally(() => {
        this.reconnectPromise = null;
      });
    }
    return this.reconnectPromise;
  }

  /**
   * Auto-reconnect wrapper for operations with exponential backoff
   */
  async withAutoReconnect<T>(operation: () => Promise<T>): Promise<T> {
    // If a reconnect is already in-flight, wait for it instead of
    // launching a parallel one.
    if (this.reconnectPromise) {
      try {
        await this.reconnectPromise;
      } catch {
        /* fall through to retry */
      }
    }

    // Pre-operation health check (uses cache for efficiency)
    try {
      await this.preOperationCheck();
    } catch {
      // If pre-check fails, try to proceed anyway
    }

    try {
      const result = await operation();
      // Reset attempt counter only after a window of consecutive
      // successes — a flapping connection that succeeds every Nth try
      // must not be able to silently bypass the breaker.
      this.consecutiveSuccesses++;
      if (this.consecutiveSuccesses >= 3) {
        this.reconnectAttempts = 0;
      }
      return result;
    } catch (error: unknown) {
      this.consecutiveSuccesses = 0;
      const message = errorMessage(error);

      const connectionErrors = [
        "WebSocket",
        "CLOSED",
        "not open",
        "disconnected",
        "readyState",
        "ECONNREFUSED",
        "ECONNRESET",
        "ETIMEDOUT",
        "EPIPE",
        "socket hang up",
        "Protocol error",
        "Target closed",
        "Session closed",
        "Execution context",
        "detached",
        "crashed",
        "Inspected target navigated",
        "aborted",
      ];

      const isConnectionError = connectionErrors.some((e) =>
        message.toLowerCase().includes(e.toLowerCase()),
      );

      if (
        isConnectionError &&
        this.reconnectAttempts < this.maxReconnectAttempts
      ) {
        this.reconnectAttempts++;

        try {
          // Coalesce: shared promise across all concurrent callers
          await this.ensureSingleReconnect();
          return await operation();
        } catch (reconnectError) {
          // If reconnect fails, try fresh start
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            try {
              const endpoint = await this.ensureCometRunning();
              await new Promise((r) => setTimeout(r, 1500));
              await this.browserConnection(endpoint);
              if ((await this.connectToReconnectTarget()) !== null) {
                return await operation();
              }
            } catch {
              // Last resort failed
            }
          }
          throw reconnectError;
        }
      }

      throw error;
    }
  }

  /**
   * Comet answering on the configured port or through its remote-debugging
   * switch, or launched on the port when no Comet runs; its browser socket
   * is where to connect. A Comet running without either is reported, never
   * restarted (principle 6): it holds the user's windows.
   */
  private async ensureCometRunning(): Promise<BrowserEndpoint> {
    const port = this.state.port;
    let comet: Awaited<ReturnType<typeof ensureCometOnPort>>;
    try {
      comet = await ensureCometOnPort(this.launch, port);
    } catch (failure) {
      throw new Error(
        `Cannot connect to Comet on the debug port ${port}: ${errorMessage(failure)}\n` +
          `Start it with:\n${this.launch.startCommand(port)}`,
      );
    }
    if (comet.kind === "running-without-port") {
      throw new CometRunsWithoutPort(port, comet);
    }
    if (comet.kind === "launched") {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return comet.endpoint;
  }

  /**
   * Reconnect to the last connected tab, on the same socket while Comet
   * keeps it open: only a dropped socket is opened again.
   */
  async reconnect(): Promise<string> {
    this.state.connected = false;
    if (!this.connection) {
      await this.browserConnection(await this.ensureCometRunning());
    }

    // Try to reconnect to last target
    if (this.lastTargetId) {
      try {
        const targets = await this.listTargets();
        if (targets.find((t) => t.id === this.lastTargetId)) {
          return await this.connect(this.lastTargetId);
        }
      } catch {
        /* target gone */
      }
    }

    const connected = await this.connectToReconnectTarget();
    if (connected !== null) return connected;

    throw new Error("No suitable tab found for reconnection");
  }

  /**
   * Connects to the best tab there is: Perplexity's main page when one is
   * open, else a page that is not Perplexity's at all (the tab choice moves
   * the connection off it before anything is typed). Never the sidecar, the
   * side panel's chat, which routes a prompt and a stop to the wrong tab.
   * Null when there is no such tab.
   */
  private async connectToReconnectTarget(): Promise<string | null> {
    const target = reconnectTarget(await this.listTargets());
    return target ? await this.connect(target.id) : null;
  }

  /**
   * Perplexity's main page and the page the agent is browsing, each a target
   * or null. The agent's page is a browsing tab by the tab list's rule
   * (`isBrowsingTab`), the main page by `isPerplexityMainPage`.
   */
  async listTabsCategorized(): Promise<{
    main: CDPTarget | null;
    agentBrowsing: CDPTarget | null;
  }> {
    const targets = await this.listTargets();

    return {
      main:
        targets.find((t) => t.type === "page" && isPerplexityMainPage(t.url)) ||
        null,
      agentBrowsing: targets.find(isBrowsingTab) || null,
    };
  }

  /** The tab the connection is on; null when it is on none. */
  connectedTabId(): string | null {
    return this.state.activeTabId ?? null;
  }

  /** Every tab, through the browser connection's Target domain. */
  async listTargets(): Promise<CDPTarget[]> {
    return (await this.browserConnection()).targets();
  }

  /** The browser's version, asked over the browser connection. */
  async browserVersion(): Promise<string> {
    return (await this.browserConnection()).version();
  }

  /**
   * The browser connection: the one held, else the one being opened, else a
   * new one on `endpoint`, or on the socket of the Comet found on the
   * configured port or through its switch. Only this opens a socket, and
   * never a second while one is opening.
   */
  private browserConnection(
    endpoint?: BrowserEndpoint,
  ): Promise<BrowserConnection> {
    if (this.connection) return Promise.resolve(this.connection);
    this.opening ??= this.openConnection(endpoint).finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  private async openConnection(
    known?: BrowserEndpoint,
  ): Promise<BrowserConnection> {
    const endpoint = known ?? (await this.foundEndpoint());
    // On WSL, check if we can connect directly (mirrored networking required)
    const port = await getWSLConnectPort(endpoint.port);
    const connection = await BrowserConnection.open({ ...endpoint, port });
    connection.onClose(() => this.connectionDropped(connection));
    this.connection = connection;
    return connection;
  }

  /**
   * The browser socket of the Comet answering on the configured port, or
   * through its switch. Launches nothing: only a reconnect does.
   */
  private async foundEndpoint(): Promise<BrowserEndpoint> {
    const port = this.state.port;
    const comet = await findCometOnPort(this.launch, port);
    if (!comet)
      throw new Error(`Comet does not answer on the debug port ${port}`);
    return comet.endpoint;
  }

  /**
   * Comet dropped the socket. The session stays, so the next operation on
   * it fails as a lost connection and reconnects.
   */
  private connectionDropped(connection: BrowserConnection): void {
    if (this.connection !== connection) return;
    this.connection = null;
    this.state.connected = false;
    this.invalidateHealthCache();
  }

  /**
   * Connect to a specific tab: attach to it on the browser connection,
   * opening that only when there is none, never a socket per tab.
   */
  async connect(targetId: string): Promise<string> {
    const connection = await this.browserConnection();
    await this.detachSession();
    const session = await connection.attach(targetId);
    this.session = session;

    await Promise.all([
      session.Page.enable(),
      session.Runtime.enable(),
      session.DOM.enable(),
      session.Network.enable(),
    ]);

    // Set window size for consistent UI
    try {
      await connection.setWindowBounds(targetId, {
        ...WINDOW_SIZE,
        windowState: "normal",
      });
    } catch {
      try {
        await session.Emulation.setDeviceMetricsOverride({
          ...WINDOW_SIZE,
          deviceScaleFactor: 1,
          mobile: false,
        });
      } catch {
        /* continue */
      }
    }

    await this.trackLifecycle(session);

    this.state.connected = true;
    this.state.activeTabId = targetId;
    this.lastTargetId = targetId;
    this.reconnectAttempts = 0;

    const { result } = await session.Runtime.evaluate({
      expression: "window.location.href",
    });
    this.state.currentUrl = result.value as string;

    return `Connected to tab: ${this.state.currentUrl}`;
  }

  /**
   * Subscribe to Page.lifecycleEvent so we can wait for paint readiness
   * (firstContentfulPaint, networkAlmostIdle, etc.) the way Lighthouse and
   * Puppeteer do, instead of polling document.readyState.
   */
  private async trackLifecycle(session: PageSession): Promise<void> {
    this.stopLifecycleTracking();
    try {
      await session.Page.setLifecycleEventsEnabled({ enabled: true });
      this.lifecycleListener = (params) => {
        const { frameId, loaderId, name } = params || {};
        if (!frameId || !loaderId || !name) return;
        const existing = this.frameLifecycle.get(frameId);
        if (!existing || existing.loaderId !== loaderId) {
          this.frameLifecycle.set(frameId, {
            loaderId,
            events: new Set([name]),
          });
        } else {
          existing.events.add(name);
        }
      };
      // chrome-remote-interface's domain event callbacks return an unsubscribe
      // function (api.js: `() => chrome.removeListener(rawEventName, handler)`).
      // Capture it so the next tab and disconnect() can deregister cleanly.
      this.lifecycleUnsubscribe = session.Page.lifecycleEvent(
        this.lifecycleListener,
      );
    } catch {
      /* lifecycle tracking is best-effort */
    }
  }

  private stopLifecycleTracking(): void {
    if (this.lifecycleUnsubscribe) {
      try {
        this.lifecycleUnsubscribe();
      } catch {
        /* ignore */
      }
      this.lifecycleUnsubscribe = null;
    }
    this.lifecycleListener = null;
    this.frameLifecycle.clear();
  }

  /**
   * Detach from the current tab, leaving the socket open. A session whose
   * socket dropped cannot be detached, and needs not be.
   */
  private async detachSession(): Promise<void> {
    await this.forgetSession()
      ?.detach()
      .catch(() => {
        /* its socket is gone */
      });
  }

  /** Drops the current tab's session from the client, and returns it. */
  private forgetSession(): PageSession | null {
    const session = this.session;
    this.session = null;
    this.stopLifecycleTracking();
    this.state.connected = false;
    this.state.activeTabId = undefined;
    return session;
  }

  /** Closes the browser socket: the servers' shutdown, and only that. */
  async disconnect(): Promise<void> {
    const connection = this.connection;
    this.forgetSession();
    this.connection = null;
    await connection?.close();
  }

  /**
   * Validate a target URL before passing it to Page.navigate.
   *
   * Allow only `http:` and `https:`. Reject:
   *   - `javascript:` / `data:` / `vbscript:` — XSS-equivalent inside the
   *     active Comet tab
   *   - `file://` — local filesystem read
   *   - `chrome:`, `devtools:`, `view-source:`, `about:` — internal pages;
   *     `Page.navigate` to these often crashes the CDP session
   *   - empty / unparseable strings
   */
  private assertNavigableUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(
        `Refusing navigation to non-http(s) URL: ${parsed.protocol}`,
      );
    }
  }

  /**
   * Navigate to a URL
   */
  async navigate(
    url: string,
    waitForLoad: boolean = true,
  ): Promise<NavigateResult> {
    const { Page } = this.connectedSession();
    this.assertNavigableUrl(url);
    const result = await Page.navigate({ url });
    if (waitForLoad) await Page.loadEventFired();
    this.state.currentUrl = url;
    return result as NavigateResult;
  }

  /**
   * Capture screenshot
   */
  async screenshot(format: "png" | "jpeg" = "png"): Promise<ScreenshotResult> {
    const { Page } = this.connectedSession();

    // Wait for paint readiness via Page.lifecycleEvent (Lighthouse/Puppeteer
    // approach). If firstContentfulPaint already fired for this document the
    // call returns synchronously; otherwise we wait up to 2s for the next FCP.
    await waitForLifecycle(
      Page,
      this.frameLifecycle,
      "firstContentfulPaint",
      2000,
    );

    return captureScreenshotWithFallback(Page, format);
  }

  /**
   * Execute JavaScript in the page context
   */
  async evaluate(expression: string): Promise<EvaluateResult> {
    return this.connectedSession().Runtime.evaluate({
      expression,
      awaitPromise: true,
      returnByValue: true,
    }) as Promise<EvaluateResult>;
  }

  /**
   * Execute JavaScript with auto-reconnect on connection loss
   */
  async safeEvaluate(expression: string): Promise<EvaluateResult> {
    return this.withAutoReconnect(async () => {
      return this.connectedSession().Runtime.evaluate({
        expression,
        awaitPromise: true,
        returnByValue: true,
      }) as Promise<EvaluateResult>;
    });
  }

  /**
   * Insert `text` at the focused element, as an IME would, whether or not
   * the window has focus. Only on Perplexity (see `refuseOffPerplexity`).
   *
   * `Input.insertText` is marked experimental in the protocol: a Comet that
   * changes it shows up when the caller reads the field back and finds the
   * text not taken, never as a silent success.
   */
  async insertText(text: string): Promise<void> {
    const { Input } = await this.onPerplexity("insert text");
    await Input.insertText({ text });
  }

  /** Press and release `key` as a real key press. Only on Perplexity. */
  async pressKey(key: TrustedKey): Promise<void> {
    const { Input } = await this.onPerplexity(`press ${key}`);
    await pressKeyOn(Input, key);
  }

  /**
   * Click at a point in the page, in viewport CSS pixels, with real pointer
   * events (see `clickAtPoint`). Only on Perplexity.
   */
  async clickAt(point: PagePoint): Promise<void> {
    const { Input } = await this.onPerplexity("click");
    await clickAtPoint(Input, point);
  }

  /**
   * Make the tab believe itself focused and visible, so trusted keys and
   * clicks reach it while Comet's window is behind others or the tab is not
   * the selected one: the browser drops them otherwise, while text
   * insertion still lands. Only on Perplexity, like the input it lets
   * through, and on until `stopFocusEmulation`; the window is not raised.
   *
   * `Emulation.setFocusEmulationEnabled` is marked experimental in the
   * protocol: a Comet that changes it shows up as a submit not taken.
   *
   * Counted: a start adds its holder before its round trip, so a stop that
   * overlaps it sees the holder and leaves the emulation on, and takes the
   * holder back if the emulation could not be switched on. The emulation is
   * turned off only when the last holder stops, so an ask, a stop and a mode
   * switch that overlap never end each other's.
   */
  async startFocusEmulation(): Promise<void> {
    const session = await this.onPerplexity("emulate focus");
    this.focusHolders.set(session, this.focusHoldersOf(session) + 1);
    try {
      await session.Emulation.setFocusEmulationEnabled({ enabled: true });
    } catch (error) {
      await this.releaseFocusHolder(session).catch(() => {});
      throw error;
    }
  }

  /**
   * End one holder's `startFocusEmulation`, and the emulation itself when it
   * was the last. Not gated on the tab's origin: stopping lets nothing more
   * through, and must happen wherever the tab went since. A stop with no
   * holder counted, as after a reconnect, still turns the emulation off.
   */
  async stopFocusEmulation(): Promise<void> {
    await this.releaseFocusHolder(this.connectedSession());
  }

  private async releaseFocusHolder(session: PageSession): Promise<void> {
    const remaining = Math.max(0, this.focusHoldersOf(session) - 1);
    this.focusHolders.set(session, remaining);
    if (remaining > 0) return;
    await session.Emulation.setFocusEmulationEnabled({ enabled: false });
  }

  private focusHoldersOf(session: PageSession): number {
    return this.focusHolders.get(session) ?? 0;
  }

  /** The session, once the connected tab is known to be on Perplexity. */
  private async onPerplexity(action: string): Promise<PageSession> {
    const session = this.connectedSession();
    await refuseOffPerplexity(session.Page, action);
    return session;
  }

  /** The address of the connected tab's top frame, read now through CDP. */
  async pageAddress(): Promise<string> {
    return readTopFrameAddress(this.connectedSession().Page);
  }

  /** Opens a tab at `url` (blank without one), through the Target domain. */
  async newTab(url?: string): Promise<CDPTarget> {
    return (await this.browserConnection()).createTarget(url ?? "");
  }

  /** Closes a tab through the Target domain; false when it could not. */
  async closeTab(targetId: string): Promise<boolean> {
    try {
      return await (await this.browserConnection()).closeTarget(targetId);
    } catch {
      return false;
    }
  }

  /** The connected tab's session, or an error when there is none. */
  private connectedSession(): PageSession {
    if (!this.session) {
      throw new Error("Not connected to Comet. Call connect() first.");
    }
    return this.session;
  }

  /**
   * Set `path` as the file of the first element `selector` matches, through
   * the protocol: the selector is a parameter of `DOM.querySelector`, never
   * script text. `DOM.setFileInputFiles` makes the browser fire the input's
   * `input` and `change` events itself, as a user's pick does (checked on
   * Comet 152), so no script runs in the page.
   *
   * Both arguments are branded: only the validators make them, so no
   * unvalidated string reaches the DOM calls. False when nothing matches.
   */
  async attachFile(
    path: ValidatedUploadPath,
    selector: ValidatedSelector,
  ): Promise<boolean> {
    return this.withAutoReconnect(async () => {
      const { DOM } = this.connectedSession();
      const document = await DOM.getDocument();
      const { nodeId } = await DOM.querySelector({
        nodeId: document.root.nodeId,
        selector,
      });
      if (!nodeId) return false;
      await DOM.setFileInputFiles({ nodeId, files: [path] });
      return true;
    });
  }
}

export const cometClient = new CometCDPClient();
