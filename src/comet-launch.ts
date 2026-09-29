// Launching Comet with its debug port, per platform: macOS and Linux run the
// Comet binary, Windows runs comet.exe, and WSL starts comet.exe on the
// Windows side through PowerShell. This is the code that meets the operating
// system, so everything it needs of the host comes in through `LaunchHost`
// and each platform's branch is tested with a stub of it.
//
// It implements `CometLaunch` (`core/comet-launch.ts`), which has no way to
// stop a process: Comet is the user's browser, and nothing here or anywhere
// in `src/` kills it (principle 6, D29).

import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import type { CometLaunch } from "./core/comet-launch.js";
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

  async probe(port: number): Promise<string | null> {
    try {
      const response = await this.host.fetch(
        `http://127.0.0.1:${port}/json/version`,
      );
      if (!response.ok) return null;
      return browserOf(await response.json());
    } catch {
      return null;
    }
  }

  async isProcessRunning(): Promise<boolean> {
    const { command, args } = processListing(this.host.platform);
    const listing = await this.host.run(command, args);
    if (listing === null) return false;
    return this.host.platform === "posix"
      ? listing.code === 0
      : listing.stdout.toLowerCase().includes("comet.exe");
  }

  async launch(port: number): Promise<string> {
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

  private async waitForPort(port: number): Promise<string> {
    await this.host.wait(WAIT.settleMs[this.host.platform]);
    for (let attempt = 1; attempt <= WAIT.attempts; attempt++) {
      const browser = await this.probe(port);
      if (browser !== null) return browser;
      await this.host.wait(WAIT.intervalMs);
    }
    throw new Error(
      `Comet was launched but did not answer on the debug port ${port} within ${Math.round((WAIT.attempts * WAIT.intervalMs) / 1000)} seconds`,
    );
  }
}

function browserOf(version: unknown): string {
  const browser = (version as { Browser?: unknown } | null)?.Browser;
  return typeof browser === "string" ? browser : "unknown version";
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

function windowsLocalAppData(): string | undefined {
  try {
    return execSync("cmd.exe /c echo %LOCALAPPDATA%", { encoding: "utf8" })
      .trim()
      .replace(/\r?\n/g, "");
  } catch {
    return undefined;
  }
}

/** The launch on the machine this server runs on. */
export const systemCometLaunch: CometLaunch = createCometLaunch({
  platform: detectPlatform(),
  cometPath: defaultCometPath(),
  fetch: (url) => windowsFetch(url),
  run,
  spawnDetached,
  windowsLocalAppData,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});
