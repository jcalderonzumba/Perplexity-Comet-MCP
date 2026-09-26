/**
 * Starts a `comet-bridge` entry the way an MCP client does and asks it for
 * its tools, so `npm run bridge:update` installs only a build that answers.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * The time a first start may take: npx clones the repository at the commit
 * and builds it before the server answers `initialize` (about 20 s on the
 * owner's machine). It is each request's timeout, since the SDK's own default
 * of 60 s would refuse a slow first build.
 */
export const BUILD_TIMEOUT_MS = 300_000;

/**
 * The names of the tools the entry's server lists. Rejects, with what the
 * server wrote to stderr, when it does not start or a request runs out of time.
 * @param {import("./bridge.mjs").BridgeEntry} entry
 * @param {number} [timeoutMs]
 * @returns {Promise<string[]>}
 */
export async function toolsOffered(entry, timeoutMs = BUILD_TIMEOUT_MS) {
  const transport = new StdioClientTransport({
    command: /** @type {string} */ (entry.command),
    args: entry.args ?? [],
    env: { ...definedOnly(process.env), ...entry.env },
    stderr: "pipe",
  });
  const stderr = collect(transport.stderr);
  const client = new Client({ name: "bridge-update", version: "1.0.0" });
  try {
    await client.connect(transport, { timeout: timeoutMs });
    const { tools } = await client.listTools(undefined, { timeout: timeoutMs });
    return tools.map((tool) => tool.name);
  } catch (error) {
    const output = stderr().trim();
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(output === "" ? reason : `${reason}\n${output}`);
  } finally {
    await client.close();
  }
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {Record<string, string>}
 */
function definedOnly(env) {
  return Object.fromEntries(
    Object.entries(env).filter(
      /** @returns {entry is [string, string]} */
      (entry) => entry[1] !== undefined,
    ),
  );
}

/**
 * @param {import("node:stream").Stream | null} stream
 * @returns {() => string} what the stream has written so far
 */
function collect(stream) {
  let text = "";
  stream?.on("data", (chunk) => {
    text += String(chunk);
  });
  return () => text;
}
