/**
 * How a battery starts the server under test, and which debug port that
 * server uses. The port is worked out once and given both to the battery,
 * which asks Comet on it, and to the server, which the SDK's stdio transport
 * otherwise starts without the battery's `COMET_PORT`. Both live batteries
 * use it.
 */

import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

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

/**
 * Whether Comet answers on the debug port, asked without the server, so that
 * a battery never makes the server launch or relaunch Comet.
 * @param {number} port
 * @returns {{ port: number, answers: () => Promise<boolean> }}
 */
export function debugPort(port) {
  return {
    port,
    answers: () =>
      fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(3000),
      }).then(
        (response) => response.ok,
        () => false,
      ),
  };
}
