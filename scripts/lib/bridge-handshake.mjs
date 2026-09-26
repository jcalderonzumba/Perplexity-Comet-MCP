/**
 * Starts a `comet-bridge` entry the way an MCP client does and asks it for
 * its tools, so `npm run bridge:update` installs only a build that answers.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * The time a first start may take: npx clones the repository at the commit
 * and builds it before the server answers (about 20 s on the owner's machine).
 */
export const BUILD_TIMEOUT_MS = 300_000;

/**
 * The names of the tools the entry's server lists. Rejects, with what the
 * server wrote to stderr, when it does not start or answer in time.
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
    const { tools } = await within(timeoutMs, async () => {
      await client.connect(transport);
      return client.listTools();
    });
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

/**
 * @template T
 * @param {number} ms
 * @param {() => Promise<T>} work
 * @returns {Promise<T>}
 */
async function within(ms, work) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`no answer within ${Math.round(ms / 1000)}s`)),
      ms,
    );
  });
  try {
    return /** @type {T} */ (await Promise.race([work(), timeout]));
  } finally {
    clearTimeout(timer);
  }
}
