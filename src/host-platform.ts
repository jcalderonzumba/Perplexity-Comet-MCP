// What the host is, for the code that talks to Comet across it: WSL detection,
// the Windows-aware fetch and PowerShell quoting. Shared by the client and the
// launch, so neither carries the other's copy.

import { execSync } from "child_process";
import { platform } from "os";

// Detect if running in WSL (must be before windowsFetch)
function isWSL(): boolean {
  if (platform() !== "linux") return false;
  try {
    const release = execSync("uname -r", { encoding: "utf8" }).toLowerCase();
    return release.includes("microsoft") || release.includes("wsl");
  } catch {
    return false;
  }
}

export const IS_WSL = isWSL();

// Escape a string for safe interpolation inside a PowerShell single-quoted
// literal: only `'` is special — double it to `''`. Also reject embedded
// NUL or newline characters, which would terminate the command line.
export function psSingleQuote(value: string): string {
  if (value.includes("\0") || /[\r\n]/.test(value)) {
    throw new Error("Refusing to pass control characters to PowerShell");
  }
  return value.replace(/'/g, "''");
}

// Windows/WSL-compatible fetch using PowerShell
// On WSL, native fetch connects to WSL's localhost, not Windows where Comet runs
export async function windowsFetch(
  url: string,
  method: string = "GET",
): Promise<{ ok: boolean; status: number; json: () => Promise<any> }> {
  // Use native fetch only on non-Windows AND non-WSL
  if (platform() !== "win32" && !IS_WSL) {
    const response = await fetch(url, { method });
    return response;
  }

  // Validate URL before passing through PowerShell: must be loopback http(s).
  // This is the trust boundary — caller-supplied tabIds and ports flow here.
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }
    if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
      throw new Error(`Refusing non-loopback host: ${parsed.hostname}`);
    }
  } catch (e: any) {
    return {
      ok: false,
      status: 0,
      json: async () => {
        throw e;
      },
    };
  }

  // On Windows or WSL, use PowerShell to reach Windows localhost
  try {
    const safeUrl = psSingleQuote(url);
    const psCommand =
      method === "PUT"
        ? `Invoke-WebRequest -Uri '${safeUrl}' -Method PUT -UseBasicParsing | Select-Object -ExpandProperty Content`
        : `Invoke-WebRequest -Uri '${safeUrl}' -UseBasicParsing | Select-Object -ExpandProperty Content`;

    const result = execSync(
      `powershell.exe -NoProfile -Command "${psCommand}"`,
      {
        encoding: "utf8",
        timeout: 10000,
        windowsHide: true,
      },
    );

    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(result.trim()),
    };
  } catch (error: any) {
    return {
      ok: false,
      status: 0,
      json: async () => {
        throw error;
      },
    };
  }
}

export const IS_WINDOWS = platform() === "win32" || IS_WSL;
