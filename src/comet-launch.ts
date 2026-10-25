// Finding and launching Comet with its debug port, per platform: macOS and
// Linux run the Comet binary, Windows runs comet.exe, and WSL starts
// comet.exe on the Windows side through PowerShell. On macOS, a Comet with
// its remote-debugging switch on is found through the `DevToolsActivePort`
// file it writes in its profile directory. This is the code that meets the
// operating system, so everything it needs of the host comes in through
// `LaunchHost` and each platform's branch is tested with a stub of it.
//
// It implements `CometLaunch` (`core/comet-launch.ts`), which has no way to
// stop a process: Comet is the user's browser, and nothing here or anywhere
// in `src/` kills it (principle 6, D29).

import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { connect } from "node:net";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import {
  type BrowserEndpoint,
  type BrowserPath,
  parseBrowserPath,
  parseDevToolsActivePort,
} from "./core/browser-endpoint.js";
import type { CometLaunch, FoundComet } from "./core/comet-launch.js";
import {
  IS_WINDOWS,
  IS_WSL,
  psSingleQuote,
  windowsFetch,
} from "./host-platform.js";

export type LaunchPlatform = "posix" | "windows" | "wsl";

/** How a listing command ended, and what it printed. */
export interface CommandResult {
  readonly code: number | null;
  readonly stdout: string;
}

/** What the launch needs of the machine it runs on. */
export interface LaunchHost {
  readonly platform: LaunchPlatform;
  /** The Comet executable, for macOS, Linux and Windows. */
  readonly cometPath: string;
  fetch(url: string): Promise<{ ok: boolean; json(): Promise<unknown> }>;
  /** Runs a command to completion; null when it cannot be run at all. */
  run(command: string, args: string[]): Promise<CommandResult | null>;
  /** Starts a process that outlives this one; rejects when it cannot start. */
  spawnDetached(command: string, args: string[]): Promise<void>;
  /** The Windows user's %LOCALAPPDATA%, read from WSL; undefined if unreadable. */
  windowsLocalAppData(): string | undefined;
  wait(ms: number): Promise<void>;
  /** Whether Comet's remote-debugging switch is looked for here: macOS only. */
  readonly usesSwitch: boolean;
  /**
   * The text of Comet's `DevToolsActivePort`; null when there is none to
   * read, and on every platform but macOS. Never reaches a reply or a log.
   */
  readDevToolsActivePort(): Promise<string | null>;
  /** Whether something accepts a TCP connection on `127.0.0.1:<port>`. */
  listensOnLoopback(port: number): Promise<boolean>;
}

/** How long a launched Comet is given to answer on its port. */
const WAIT = {
  attempts: 40,
  intervalMs: 500,
  settleMs: { posix: 1500, windows: 1500, wsl: 2000 },
} as const;

/**
 * The args passed to the Comet binary. Always includes
 * `--remote-allow-origins=http://127.0.0.1` so other processes on the host
 * (which can resolve `localhost.<attacker>.com` -> 127.0.0.1 via DNS
 * rebinding from a browser they control) cannot attach to Comet's
 * unauthenticated CDP endpoint and steal cookies / read tabs.
 *
 * See https://crbug.com/1247276 for the underlying mitigation.
 */
export function cometLaunchArgs(port: number): string[] {
  return [
    `--remote-debugging-port=${port}`,
    `--remote-allow-origins=http://127.0.0.1`,
  ];
}

/** The launch over `host`. */
export function createCometLaunch(host: LaunchHost): CometLaunch {
  return new PlatformCometLaunch(host);
}

class PlatformCometLaunch implements CometLaunch {
  constructor(private readonly host: LaunchHost) {}

  get usesSwitch(): boolean {
    return this.host.usesSwitch;
  }

  async probe(port: number): Promise<FoundComet | null> {
    try {
      const response = await this.host.fetch(
        `http://127.0.0.1:${port}/json/version`,
      );
      if (!response.ok) return null;
      return foundOn(port, await response.json());
    } catch {
      return null;
    }
  }

  async switchEndpoint(): Promise<BrowserEndpoint | null> {
    const text = await this.host.readDevToolsActivePort();
    const endpoint = text === null ? null : parseDevToolsActivePort(text);
    if (endpoint === null) return null;
    return (await this.host.listensOnLoopback(endpoint.port)) ? endpoint : null;
  }

  async isProcessRunning(): Promise<boolean> {
    const { command, args } = processListing(this.host.platform);
    const listing = await this.host.run(command, args);
    if (listing === null) return false;
    return this.host.platform === "posix"
      ? listing.code === 0
      : listing.stdout.toLowerCase().includes("comet.exe");
  }

  async launch(port: number): Promise<FoundComet> {
    assertPort(port);
    await this.start(port);
    return this.waitForPort(port);
  }

  startCommand(port: number): string {
    if (this.host.platform === "wsl") {
      return `powershell.exe -Command "${powerShellStart(this.wslCometPath(), port)}"`;
    }
    return `"${this.host.cometPath}" ${cometLaunchArgs(port).join(" ")}`;
  }

  private async start(port: number): Promise<void> {
    if (this.host.platform === "wsl") {
      const psCommand = `Set-Location C:\\; ${powerShellStart(this.wslCometPath(), port)}`;
      return this.host.spawnDetached("powershell.exe", [
        "-NoProfile",
        "-Command",
        psCommand,
      ]);
    }
    return this.host.spawnDetached(this.host.cometPath, cometLaunchArgs(port));
  }

  private wslCometPath(): string {
    const localAppData =
      this.host.windowsLocalAppData() ??
      `C:\\Users\\${process.env.USER || "user"}\\AppData\\Local`;
    return `${localAppData}\\Perplexity\\Comet\\Application\\Comet.exe`;
  }

  private async waitForPort(port: number): Promise<FoundComet> {
    await this.host.wait(WAIT.settleMs[this.host.platform]);
    for (let attempt = 1; attempt <= WAIT.attempts; attempt++) {
      const found = await this.probe(port);
      if (found !== null) return found;
      await this.host.wait(WAIT.intervalMs);
    }
    throw new Error(
      `Comet was launched but did not answer on the debug port ${port} within ${Math.round((WAIT.attempts * WAIT.intervalMs) / 1000)} seconds`,
    );
  }
}

/**
 * The Comet `/json/version` describes on `port`, or null when it names no
 * browser socket. Only the socket's path is taken, and only a path
 * `parseBrowserPath` accepts: the address is always `127.0.0.1` on the port
 * probed, whatever host and port the answer names (principle 4).
 */
function foundOn(port: number, version: unknown): FoundComet | null {
  const { Browser, webSocketDebuggerUrl } = (version ?? {}) as {
    Browser?: unknown;
    webSocketDebuggerUrl?: unknown;
  };
  const path = browserPathOf(webSocketDebuggerUrl);
  if (path === null) return null;
  const browser = typeof Browser === "string" ? Browser : "unknown version";
  return { browser, endpoint: { port, path } };
}

function browserPathOf(address: unknown): BrowserPath | null {
  if (typeof address !== "string") return null;
  try {
    const { pathname, search, hash } = new URL(address);
    return parseBrowserPath(`${pathname}${search}${hash}`);
  } catch {
    return null;
  }
}

function processListing(launchPlatform: LaunchPlatform): {
  command: string;
  args: string[];
} {
  if (launchPlatform === "posix") {
    return { command: "pgrep", args: ["-f", "Comet.app"] };
  }
  return {
    command: launchPlatform === "wsl" ? "tasklist.exe" : "tasklist",
    args: ["/FI", "IMAGENAME eq comet.exe", "/NH"],
  };
}

// `port` is a typed number in TypeScript, but the runtime cannot enforce
// that, and on WSL it is interpolated into a PowerShell command.
function assertPort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port for Comet launch: ${port}`);
  }
}

// Start-Process with each launch arg as its own single-quoted entry of the
// ArgumentList, which PowerShell turns into separate argv elements.
function powerShellStart(cometPath: string, port: number): string {
  const args = cometLaunchArgs(port)
    .map((arg) => `'${psSingleQuote(arg)}'`)
    .join(",");
  return `Start-Process -FilePath '${psSingleQuote(cometPath)}' -ArgumentList ${args}`;
}

// ---------------------------------------------------------------------------
// The real host
// ---------------------------------------------------------------------------

function detectPlatform(): LaunchPlatform {
  if (IS_WSL) return "wsl";
  return platform() === "win32" ? "windows" : "posix";
}

function defaultCometPath(): string {
  if (process.env.COMET_PATH) return process.env.COMET_PATH;
  if (!IS_WINDOWS) return "/Applications/Comet.app/Contents/MacOS/Comet";

  // Common Windows installation paths for Comet (Perplexity). On WSL they
  // are only a reference: the launch goes through PowerShell.
  const candidates = [
    `${process.env.LOCALAPPDATA}\\Perplexity\\Comet\\Application\\comet.exe`,
    `${process.env.APPDATA}\\Perplexity\\Comet\\Application\\comet.exe`,
    "C:\\Program Files\\Perplexity\\Comet\\Application\\comet.exe",
    "C:\\Program Files (x86)\\Perplexity\\Comet\\Application\\comet.exe",
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function run(command: string, args: string[]): Promise<CommandResult | null> {
  return new Promise((resolve) => {
    const child = spawn(command, args);
    let stdout = "";
    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    child.on("close", (code) => resolve({ code, stdout }));
    child.on("error", () => resolve(null));
  });
}

function spawnDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

/** The part of the filesystem `readDevToolsActivePort` reads through. */
export interface ActivePortFiles {
  lstat(path: string): Promise<{ isFile(): boolean; size: number }>;
  readFile(path: string): Promise<Buffer>;
}

/** Larger than any `DevToolsActivePort` Comet writes. */
const ACTIVE_PORT_MAX_BYTES = 1024;

/**
 * Where Comet writes `DevToolsActivePort` with its remote-debugging switch
 * on, on the one platform the switch is used on: macOS. Null elsewhere.
 */
export function devToolsActivePortPath(
  os: NodeJS.Platform,
  wsl: boolean,
  home: string,
): string | null {
  if (os !== "darwin" || wsl) return null;
  return join(
    home,
    "Library",
    "Application Support",
    "Comet",
    "DevToolsActivePort",
  );
}

/**
 * The text of the file at `path`, read-only; null when there is no path, or
 * the file is absent, unreadable, not a regular file (a symlink included)
 * or larger than 1 KiB.
 */
export async function readDevToolsActivePort(
  path: string | null,
  files: ActivePortFiles = { lstat, readFile },
): Promise<string | null> {
  if (path === null) return null;
  try {
    const entry = await files.lstat(path);
    if (!entry.isFile() || entry.size > ACTIVE_PORT_MAX_BYTES) return null;
    const content = await files.readFile(path);
    if (content.byteLength > ACTIVE_PORT_MAX_BYTES) return null;
    return content.toString("utf8");
  } catch {
    return null;
  }
}

/** How long a TCP connection to the switch's port is given. */
const LOOPBACK_CONNECT_MS = 1000;

/**
 * Whether something accepts a TCP connection on `127.0.0.1:<port>`: a plain
 * connect, closed at once, with no WebSocket, so Comet asks the user nothing.
 */
export function listensOnLoopback(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const settle = (listening: boolean) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(LOOPBACK_CONNECT_MS);
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
    socket.once("timeout", () => settle(false));
  });
}

function windowsLocalAppData(): string | undefined {
  try {
    return execSync("cmd.exe /c echo %LOCALAPPDATA%", { encoding: "utf8" })
      .trim()
      .replace(/\r?\n/g, "");
  } catch {
    return undefined;
  }
}

const activePortPath = devToolsActivePortPath(platform(), IS_WSL, homedir());

/** The launch on the machine this server runs on. */
export const systemCometLaunch: CometLaunch = createCometLaunch({
  platform: detectPlatform(),
  cometPath: defaultCometPath(),
  fetch: (url) => windowsFetch(url),
  run,
  spawnDetached,
  windowsLocalAppData,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  usesSwitch: activePortPath !== null,
  readDevToolsActivePort: () => readDevToolsActivePort(activePortPath),
  listensOnLoopback,
});
