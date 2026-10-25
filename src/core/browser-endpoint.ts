// Where Comet's browser WebSocket is, and the two places that name it: the
// path `/json/version` gives with the flag, and the `DevToolsActivePort` file
// Comet writes with its remote-debugging switch. Both are parsed here, to
// a port and a path and nothing else, so the address the connection builds
// is always on `127.0.0.1`, whatever either says (principle 4).

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

const ACTIVE_PORT_FILE = /^([1-9][0-9]{0,4})\n([^\n]*)\n?$/;

/**
 * The endpoint `DevToolsActivePort` names: a port from 1 to 65535 on line 1,
 * a browser path on line 2, an optional trailing newline, and nothing else.
 * Anything else is null.
 */
export function parseDevToolsActivePort(text: string): BrowserEndpoint | null {
  const lines = ACTIVE_PORT_FILE.exec(text);
  if (lines === null) return null;
  const port = Number(lines[1]);
  const path = parseBrowserPath(lines[2]);
  if (port > 65535 || path === null) return null;
  return { port, path };
}
