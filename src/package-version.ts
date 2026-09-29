// The version this package ships, read from its package.json, so the MCP
// `initialize` handshake and the bridge's `/health` report the shipped
// version and never a copy that drifts every release.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** `package.json`'s version, or `0.0.0` when it cannot be read. */
export function packageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(
      readFileSync(join(here, "..", "package.json"), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
