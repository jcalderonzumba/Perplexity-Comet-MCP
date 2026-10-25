/**
 * How a battery starts the server under test, and which debug port that
 * server uses. The port is worked out once and given both to the battery,
 * which asks Comet on it, and to the server, which the SDK's stdio transport
 * otherwise starts without the battery's `COMET_PORT`. When nothing answers
 * there, the battery finds Comet through its remote-debugging switch, as the
 * server does. Both live batteries use it.
 */

import { lstat, readFile } from "node:fs/promises";
import { connect } from "node:net";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import CDP from "chrome-remote-interface";

/** @typedef {import("@modelcontextprotocol/sdk/client/stdio.js").StdioServerParameters} StdioServerParameters */

const SERVER_DEFAULT_PORT = 9223;

/**
 * The server's debug port: `COMET_PORT` when it is a valid port, otherwise
 * 9223, the same rule the server applies.
 * @param {Record<string, string | undefined>} env
 * @returns {number}
 */
export function debugPortFromEnv(env) {
  const port = Number.parseInt(env.COMET_PORT ?? "", 10);
  return Number.isInteger(port) && port >= 1 && port <= 65535
    ? port
    : SERVER_DEFAULT_PORT;
}

/**
 * The debug port, and the parameters that start the server on that same port:
 * the SDK's default environment plus `COMET_PORT`, and nothing else of the
 * battery's environment.
 * @param {string} entry the server's built entry point
 * @param {Record<string, string | undefined>} env the battery's environment
 * @returns {{ port: number, parameters: StdioServerParameters }}
 */
export function serverUnderTest(entry, env) {
  const port = debugPortFromEnv(env);
  return {
    port,
    parameters: {
      command: "node",
      args: [entry],
      env: { ...getDefaultEnvironment(), COMET_PORT: String(port) },
    },
  };
}

const DEBUG_PORT_TIMEOUT_MS = 3000;

/**
 * How long the server waits for the user to answer Comet's allow dialog
 * (`ALLOW_DIALOG_BOUND_MS` in `src/browser-connection.ts`); the battery
 * waits as long for its own.
 */
export const ALLOW_DIALOG_BOUND_MS = 30_000;

/**
 * A read-only connection to one of Comet's pages, as the battery needs it.
 * @typedef {{ Runtime: { evaluate: (params: { expression: string }) => Promise<{ result: { value?: unknown } }> }, close: () => Promise<unknown> }} PageConnection
 */

/**
 * Opens a connection to a page of Comet by its target id, through the debug
 * port.
 * @typedef {(targetId: string) => Promise<PageConnection>} OpenPage
 */

/**
 * Opens the one socket to Comet's browser that the switch's file names.
 * @typedef {{ port: number, path: string }} BrowserEndpoint
 * @typedef {{ targetId: string, type: string, url: string }} TargetInfo
 * @typedef {{
 *   Target: {
 *     getTargets: () => Promise<{ targetInfos: TargetInfo[] }>,
 *     attachToTarget: (params: { targetId: string, flatten: boolean }) => Promise<{ sessionId: string }>,
 *   },
 *   Runtime: {
 *     evaluate: (params: { expression: string }, sessionId: string) => Promise<{ result: { value?: unknown } }>,
 *   },
 * }} BrowserClient
 * @typedef {(endpoint: BrowserEndpoint) => Promise<BrowserClient>} OpenBrowser
 */

/**
 * How the battery reaches Comet; each defaults to the real one.
 * @typedef {object} DebugPortSeams
 * @property {OpenPage} [openPage] a page through the flag: CDP over the debug port
 * @property {() => Promise<string | null>} [activePortText] the text of the switch's `DevToolsActivePort`: the file, on macOS only
 * @property {OpenBrowser} [openBrowser] the switch's browser socket: CDP on `127.0.0.1`
 * @property {(line: string) => void} [say] the line that asks the user to click: the console
 */

/** @typedef {{ id: string, url: string }} PageTarget */

/**
 * The pages Comet has open, and the visibility of one of them.
 * @typedef {{ pageTargets: () => Promise<PageTarget[]>, visibility: (targetId: string) => Promise<string> }} PageReads
 */

const CLICK_LINE =
  "Comet is asking to allow remote debugging: click Allow in Comet (twice: once for the battery, once for the server).";

const VISIBILITY = "document.visibilityState";

/**
 * Whether Comet answers, asked without the server, so that a battery never
 * makes the server launch or relaunch Comet: on the debug port, or else
 * through its remote-debugging switch, found as the server finds it; the
 * addresses of the pages Comet has open, which the Pro battery reads to tell
 * Perplexity's threads apart; and whether Comet's main Perplexity page is
 * hidden, which the no-pro battery reads to say whether a mode switch ran
 * with the window behind others. Reads only: it evaluates
 * `document.visibilityState` and nothing else. Through the switch, every
 * read goes over one browser socket, opened once, so Comet asks the user
 * once for the battery.
 * @param {number} port
 * @param {DebugPortSeams} [seams]
 * @returns {{ port: number, answers: () => Promise<boolean>, pageAddresses: () => Promise<string[]>, pageVisibility: () => Promise<string | undefined> }}
 */
export function debugPort(port, seams = {}) {
  const {
    openPage = (targetId) => CDP({ host: "127.0.0.1", port, target: targetId }),
    activePortText = () =>
      activePortFileText(activePortPath(platform(), homedir())),
    openBrowser = (endpoint) =>
      CDP({
        target: `ws://127.0.0.1:${endpoint.port}${endpoint.path}`,
        local: true,
      }),
    say = console.log,
  } = seams;
  const flag = flagReads(port, openPage);
  const find = async () => {
    if (await flag.answers()) return { found: true, reads: flag };
    const endpoint = await listeningEndpoint(await activePortText());
    if (endpoint === null) return { found: false, reads: flag };
    say(CLICK_LINE);
    return { found: true, reads: switchReads(endpoint, openBrowser) };
  };
  /** @type {Promise<{ found: boolean, reads: PageReads }> | undefined} */
  let finding;
  const comet = () => {
    finding ??= find();
    return finding;
  };
  return {
    port,
    answers: async () => (await comet()).found,
    pageAddresses: async () =>
      (await (await comet()).reads.pageTargets()).map((target) => target.url),
    pageVisibility: async () => {
      const { reads } = await comet();
      const main = (await reads.pageTargets()).find(isMainPerplexityPage);
      return main === undefined ? undefined : reads.visibility(main.id);
    },
  };
}

/**
 * Comet through the flag: `/json/version` and `/json/list` over HTTP, and a
 * connection per page read.
 * @param {number} port
 * @param {OpenPage} openPage
 * @returns {PageReads & { answers: () => Promise<boolean> }}
 */
function flagReads(port, openPage) {
  const ask = (/** @type {string} */ path) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      signal: AbortSignal.timeout(DEBUG_PORT_TIMEOUT_MS),
    });
  return {
    answers: () =>
      ask("/json/version").then(
        (response) => response.ok,
        () => false,
      ),
    pageTargets: async () =>
      (await pageTargetsIn(await ask("/json/list"))).map((target) => ({
        id: String(target.id),
        url: String(target.url),
      })),
    visibility: async (targetId) => visibilityOf(await openPage(targetId)),
  };
}

/**
 * Comet through its switch: one browser socket, opened on the first read and
 * waited for up to the dialog's bound on each; the targets through the
 * `Target` domain, and the page read through one attached session.
 * @param {BrowserEndpoint} endpoint
 * @param {OpenBrowser} openBrowser
 * @returns {PageReads}
 */
function switchReads(endpoint, openBrowser) {
  /** @type {Promise<BrowserClient> | undefined} */
  let socket;
  /** @type {{ targetId: string, sessionId: string } | undefined} */
  let session;
  const browser = () => {
    if (socket === undefined) {
      socket = openBrowser(endpoint);
      // The user's answer is kept for the next read when none is waiting.
      socket.catch(() => {});
    }
    return withinDialogBound(socket);
  };
  return {
    pageTargets: async () => {
      const { targetInfos } = await (await browser()).Target.getTargets();
      return targetInfos
        .filter((target) => target.type === "page")
        .map(({ targetId, url }) => ({ id: targetId, url }));
    },
    visibility: async (targetId) => {
      const client = await browser();
      if (session?.targetId !== targetId) {
        const { sessionId } = await client.Target.attachToTarget({
          targetId,
          flatten: true,
        });
        session = { targetId, sessionId };
      }
      const { result } = await client.Runtime.evaluate(
        { expression: VISIBILITY },
        session.sessionId,
      );
      return String(result.value);
    },
  };
}

/**
 * `socket`, or a failure once the dialog's bound has passed; the socket
 * itself stays pending.
 * @param {Promise<BrowserClient>} socket
 * @returns {Promise<BrowserClient>}
 */
function withinDialogBound(socket) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  const bound = new Promise((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Comet's allow dialog for the battery was not answered within ${ALLOW_DIALOG_BOUND_MS / 1000} s: click Allow in Comet`,
          ),
        ),
      ALLOW_DIALOG_BOUND_MS,
    );
  });
  return Promise.race([socket, bound]).finally(() => clearTimeout(timer));
}

const BROWSER_PATH =
  /^\/devtools\/browser\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACTIVE_PORT_FILE = /^([1-9][0-9]{0,4})\n([^\n]*)\n?$/;

/**
 * The endpoint `DevToolsActivePort` names, read by the server's rule
 * (`parseDevToolsActivePort` in `src/core/browser-endpoint.ts`): a port from
 * 1 to 65535 on line 1, a browser path on line 2, an optional trailing
 * newline, and nothing else. Anything else is null.
 * @param {string} text
 * @returns {BrowserEndpoint | null}
 */
export function parseDevToolsActivePort(text) {
  const lines = ACTIVE_PORT_FILE.exec(text);
  if (lines === null) return null;
  const [, digits = "", path = ""] = lines;
  const port = Number(digits);
  return port <= 65535 && BROWSER_PATH.test(path) ? { port, path } : null;
}

/**
 * Where Comet writes `DevToolsActivePort` with its switch on, on the one
 * platform the switch is used on: macOS. Null elsewhere.
 * @param {NodeJS.Platform} os
 * @param {string} home
 * @returns {string | null}
 */
export function activePortPath(os, home) {
  return os === "darwin"
    ? join(
        home,
        "Library",
        "Application Support",
        "Comet",
        "DevToolsActivePort",
      )
    : null;
}

/** Larger than any `DevToolsActivePort` Comet writes. */
const ACTIVE_PORT_MAX_BYTES = 1024;

/**
 * The text of the file at `path`, read-only; null when there is no path, or
 * the file is absent, unreadable, not a regular file (a symlink included) or
 * larger than 1 KiB.
 * @param {string | null} path
 * @returns {Promise<string | null>}
 */
export async function activePortFileText(path) {
  if (path === null) return null;
  try {
    const entry = await lstat(path);
    if (!entry.isFile() || entry.size > ACTIVE_PORT_MAX_BYTES) return null;
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/** How long a TCP connection to the switch's port is given. */
const LOOPBACK_CONNECT_MS = 1000;

/**
 * The endpoint `text` names, when something accepts a plain TCP connection
 * on its port: no WebSocket, so Comet asks the user nothing. Null otherwise.
 * @param {string | null} text
 * @returns {Promise<BrowserEndpoint | null>}
 */
async function listeningEndpoint(text) {
  const endpoint = text === null ? null : parseDevToolsActivePort(text);
  if (endpoint === null) return null;
  const listening = await new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port: endpoint.port });
    const settle = (/** @type {boolean} */ answer) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(LOOPBACK_CONNECT_MS);
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
    socket.once("timeout", () => settle(false));
  });
  return listening ? endpoint : null;
}

/**
 * `document.visibilityState` of a page, read once; the connection is closed
 * whatever the read does.
 * @param {PageConnection} page
 * @returns {Promise<string>}
 */
async function visibilityOf(page) {
  try {
    const { result } = await page.Runtime.evaluate({
      expression: "document.visibilityState",
    });
    return String(result.value);
  } finally {
    await page.close();
  }
}

/**
 * Perplexity's own page, as `comet_connect` tells it from the sidecar.
 * @param {PageTarget} target
 */
function isMainPerplexityPage(target) {
  const url = String(target.url);
  return url.includes("perplexity.ai") && !url.includes("sidecar");
}

/**
 * The page targets in the debug port's target list.
 * @param {Response} response
 * @returns {Promise<{ id?: string, type?: string, url?: string }[]>}
 */
async function pageTargetsIn(response) {
  if (!response.ok) {
    throw new Error(`the debug port's page list answered ${response.status}`);
  }
  /** @type {{ id?: string, type?: string, url?: string }[]} */
  const targets = await response.json();
  return targets.filter((target) => target.type === "page");
}
