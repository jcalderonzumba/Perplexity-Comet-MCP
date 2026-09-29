// CDP Client wrapper for Comet browser control
// Modified for Windows/WSL support

import CDP from "chrome-remote-interface";
import { systemCometLaunch } from "./comet-launch.js";
import {
  type CometLaunch,
  CometRunsWithoutPort,
  ensureCometOnPort,
} from "./core/comet-launch.js";
import { isBrowsingTab } from "./core/tabs.js";
import { errorMessage } from "./error-message.js";
import { IS_WINDOWS, IS_WSL, windowsFetch } from "./host-platform.js";
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

export class CometCDPClient {
  private client: CDP.Client | null = null;
  /**
   * How many callers hold focus emulation, per connection: it is one on/off
   * switch per CDP session, so it ends only when its last holder stops.
   */
  private readonly focusHolders = new WeakMap<CDP.Client, number>();
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
  // their own reconnect — they would race on `this.client` (one closes
  // while another is mid-handshake), corrupting state. We cache the
  // single promise and let all waiters await it.
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
  private lifecycleListener: ((params: any) => void) | null = null;
  private lifecycleUnsubscribe: (() => unknown) | null = null;

  constructor(options: CometClientOptions = {}) {
    this.launch = options.launch ?? systemCometLaunch;
    this.state.port = options.port ?? DEFAULT_PORT;
  }

  get isConnected(): boolean {
    return this.state.connected && this.client !== null;
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

    if (!this.client) {
      this.healthCheckCache = false;
      this.lastHealthCheck = now;
      return false;
    }

    try {
      await this.client.Runtime.evaluate({ expression: "1+1", timeout: 3000 });
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
    // Quick check if client exists
    if (!this.client) {
      await this.reconnect();
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
      await this.reconnect();
    }
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
              await this.ensureCometRunning();
              await new Promise((r) => setTimeout(r, 1500));
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
   * Comet answering on the configured port: found there, or launched when no
   * Comet runs. A Comet running without the port is reported, never
   * restarted (principle 6): it holds the user's windows.
   */
  private async ensureCometRunning(): Promise<void> {
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
      throw new CometRunsWithoutPort(port, comet.command);
    }
    if (comet.kind === "launched") {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  /**
   * Reconnect to the last connected tab
   */
  async reconnect(): Promise<string> {
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        /* ignore */
      }
    }
    this.state.connected = false;
    this.client = null;

    await this.ensureCometRunning();

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

  /**
   * List all available tabs/targets
   */
  async listTargets(): Promise<CDPTarget[]> {
    // On WSL, use HTTP via PowerShell (WebSocket doesn't work across WSL/Windows boundary)
    if (IS_WSL) {
      const response = await windowsFetch(
        `http://127.0.0.1:${this.state.port}/json/list`,
      );
      if (!response.ok)
        throw new Error(`Failed to list targets: ${response.status}`);
      return response.json() as Promise<CDPTarget[]>;
    }

    // On native Windows (not WSL), use CDP Target.getTargets() to avoid HTTP issues
    if (IS_WINDOWS) {
      try {
        const tempClient = await CDP({
          port: this.state.port,
          host: "127.0.0.1",
        });
        try {
          const { targetInfos } = await (tempClient as any).Target.getTargets();
          return targetInfos.map((t: any) => ({
            id: t.targetId,
            type: t.type,
            title: t.title,
            url: t.url,
            webSocketDebuggerUrl: `ws://127.0.0.1:${this.state.port}/devtools/page/${t.targetId}`,
          }));
        } finally {
          // Close in `finally` so a throw inside `Target.getTargets()` does
          // not leak the underlying WebSocket. Each retry in withAutoReconnect
          // calls listTargets() again — even a slow leak exhausts handles.
          await tempClient.close().catch(() => {
            /* already closed */
          });
        }
      } catch (error) {
        throw new Error(`Failed to list targets: ${error}`);
      }
    }

    // Fallback for other platforms (macOS, Linux)
    const response = await windowsFetch(
      `http://127.0.0.1:${this.state.port}/json/list`,
    );
    if (!response.ok)
      throw new Error(`Failed to list targets: ${response.status}`);
    return response.json() as Promise<CDPTarget[]>;
  }

  /**
   * Connect to a specific tab
   */
  async connect(targetId?: string): Promise<string> {
    if (this.client) {
      await this.disconnect();
    }

    // On WSL, check if we can connect directly (mirrored networking required)
    const connectPort = await getWSLConnectPort(this.state.port);

    const options: CDP.Options = { port: connectPort, host: "127.0.0.1" };
    if (targetId) options.target = targetId;

    this.client = await CDP(options);

    await Promise.all([
      this.client.Page.enable(),
      this.client.Runtime.enable(),
      this.client.DOM.enable(),
      this.client.Network.enable(),
    ]);

    // Set window size for consistent UI
    try {
      const { windowId } = await (
        this.client as any
      ).Browser.getWindowForTarget({ targetId });
      await (this.client as any).Browser.setWindowBounds({
        windowId,
        bounds: { width: 1440, height: 900, windowState: "normal" },
      });
    } catch {
      try {
        await (this.client as any).Emulation.setDeviceMetricsOverride({
          width: 1440,
          height: 900,
          deviceScaleFactor: 1,
          mobile: false,
        });
      } catch {
        /* continue */
      }
    }

    // Subscribe to Page.lifecycleEvent so we can wait for paint readiness
    // (firstContentfulPaint, networkAlmostIdle, etc.) the way Lighthouse and
    // Puppeteer do, instead of polling document.readyState.
    this.frameLifecycle.clear();
    if (this.lifecycleUnsubscribe) {
      try {
        this.lifecycleUnsubscribe();
      } catch {
        /* ignore */
      }
      this.lifecycleUnsubscribe = null;
    }
    this.lifecycleListener = null;
    try {
      await this.client.Page.setLifecycleEventsEnabled({ enabled: true });
      this.lifecycleListener = (params: any) => {
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
      // Capture it so disconnect() can deregister cleanly.
      this.lifecycleUnsubscribe = this.client.Page.lifecycleEvent(
        this.lifecycleListener,
      );
    } catch {
      /* lifecycle tracking is best-effort */
    }

    this.state.connected = true;
    this.state.activeTabId = targetId;
    this.lastTargetId = targetId;
    this.reconnectAttempts = 0;

    const { result } = await this.client.Runtime.evaluate({
      expression: "window.location.href",
    });
    this.state.currentUrl = result.value as string;

    return `Connected to tab: ${this.state.currentUrl}`;
  }

  /**
   * Disconnect from current tab
   */
  async disconnect(): Promise<void> {
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
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.state.connected = false;
      this.state.activeTabId = undefined;
    }
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
    this.ensureConnected();
    this.assertNavigableUrl(url);
    const result = await this.client!.Page.navigate({ url });
    if (waitForLoad) await this.client!.Page.loadEventFired();
    this.state.currentUrl = url;
    return result as NavigateResult;
  }

  /**
   * Capture screenshot
   */
  async screenshot(format: "png" | "jpeg" = "png"): Promise<ScreenshotResult> {
    this.ensureConnected();

    // Wait for paint readiness via Page.lifecycleEvent (Lighthouse/Puppeteer
    // approach). If firstContentfulPaint already fired for this document the
    // call returns synchronously; otherwise we wait up to 2s for the next FCP.
    await waitForLifecycle(
      this.client!.Page,
      this.frameLifecycle,
      "firstContentfulPaint",
      2000,
    );

    return captureScreenshotWithFallback(this.client!.Page, format);
  }

  /**
   * Execute JavaScript in the page context
   */
  async evaluate(expression: string): Promise<EvaluateResult> {
    this.ensureConnected();
    return this.client!.Runtime.evaluate({
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
      this.ensureConnected();
      return this.client!.Runtime.evaluate({
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
    const client = await this.onPerplexity("emulate focus");
    this.focusHolders.set(client, this.focusHoldersOf(client) + 1);
    try {
      await client.Emulation.setFocusEmulationEnabled({ enabled: true });
    } catch (error) {
      await this.releaseFocusHolder(client).catch(() => {});
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
    this.ensureConnected();
    await this.releaseFocusHolder(this.client!);
  }

  private async releaseFocusHolder(client: CDP.Client): Promise<void> {
    const remaining = Math.max(0, this.focusHoldersOf(client) - 1);
    this.focusHolders.set(client, remaining);
    if (remaining > 0) return;
    await client.Emulation.setFocusEmulationEnabled({ enabled: false });
  }

  private focusHoldersOf(client: CDP.Client): number {
    return this.focusHolders.get(client) ?? 0;
  }

  /** The connection, once the connected tab is known to be on Perplexity. */
  private async onPerplexity(action: string): Promise<CDP.Client> {
    this.ensureConnected();
    const client = this.client!;
    await refuseOffPerplexity(client.Page, action);
    return client;
  }

  /** The address of the connected tab's top frame, read now through CDP. */
  async pageAddress(): Promise<string> {
    this.ensureConnected();
    return readTopFrameAddress(this.client!.Page);
  }

  /**
   * Create a new tab
   */
  async newTab(url?: string): Promise<CDPTarget> {
    const response = await windowsFetch(
      `http://127.0.0.1:${this.state.port}/json/new${url ? `?${url}` : ""}`,
      "PUT",
    );
    if (!response.ok)
      throw new Error(`Failed to create new tab: ${response.status}`);
    return response.json() as Promise<CDPTarget>;
  }

  /**
   * Close a tab
   */
  async closeTab(targetId: string): Promise<boolean> {
    try {
      if (this.client) {
        const result = await this.client.Target.closeTarget({ targetId });
        return result.success;
      }
    } catch {
      /* fallback to HTTP */
    }

    try {
      const response = await windowsFetch(
        `http://127.0.0.1:${this.state.port}/json/close/${targetId}`,
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  private ensureConnected(): void {
    this.connectedClient();
  }

  /** The connection, or an error when there is none. */
  private connectedClient(): CDP.Client {
    if (!this.client) {
      throw new Error("Not connected to Comet. Call connect() first.");
    }
    return this.client;
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
      const { DOM } = this.connectedClient();
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
