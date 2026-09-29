/**
 * How a battery starts the server under test, and which debug port that
 * server uses. The port is worked out once and given both to the battery,
 * which asks Comet on it, and to the server, which the SDK's stdio transport
 * otherwise starts without the battery's `COMET_PORT`. Both live batteries
 * use it.
 */

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
 * A read-only connection to one of Comet's pages, as the battery needs it.
 * @typedef {{ Runtime: { evaluate: (params: { expression: string }) => Promise<{ result: { value?: unknown } }> }, close: () => Promise<unknown> }} PageConnection
 */

/**
 * Opens a connection to a page of Comet by its target id, through the debug
 * port.
 * @typedef {(targetId: string) => Promise<PageConnection>} OpenPage
 */

/**
 * Whether Comet answers on the debug port, asked without the server, so that
 * a battery never makes the server launch or relaunch Comet; the addresses
 * of the pages Comet has open, which the Pro battery reads to tell
 * Perplexity's threads apart; and whether Comet's main Perplexity page is
 * hidden, which the no-pro battery reads to say whether a mode switch ran
 * with the window behind others. Reads only: it evaluates
 * `document.visibilityState` and nothing else.
 * @param {number} port
 * @param {OpenPage} [openPage] how a page is opened; CDP over the debug port
 * @returns {{ port: number, answers: () => Promise<boolean>, pageAddresses: () => Promise<string[]>, pageVisibility: () => Promise<string | undefined> }}
 */
export function debugPort(
  port,
  openPage = (targetId) => CDP({ host: "127.0.0.1", port, target: targetId }),
) {
  const ask = (/** @type {string} */ path) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      signal: AbortSignal.timeout(DEBUG_PORT_TIMEOUT_MS),
    });
  return {
    port,
    answers: () =>
      ask("/json/version").then(
        (response) => response.ok,
        () => false,
      ),
    pageAddresses: async () =>
      (await pageTargetsIn(await ask("/json/list"))).map((target) =>
        String(target.url),
      ),
    pageVisibility: async () => {
      const main = (await pageTargetsIn(await ask("/json/list"))).find(
        isMainPerplexityPage,
      );
      return main === undefined
        ? undefined
        : visibilityOf(await openPage(String(main.id)));
    },
  };
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
 * @param {{ url?: string }} target
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
