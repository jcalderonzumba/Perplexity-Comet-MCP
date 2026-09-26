/**
 * The pieces of `npm run bridge:update` that decide rather than act: which
 * repository and commit the user-scope `comet-bridge` server runs, the port it
 * keeps, the entry that replaces it, and whether a build offers every tool.
 */

export const BRIDGE_NAME = "comet-bridge";

/** The port the server uses when nothing sets `COMET_PORT` (`src/cdp-client.ts`). */
const SERVER_DEFAULT_PORT = "9223";

/** Every tool the stdio server declares; a build missing one is not installed. */
export const BRIDGE_TOOLS = Object.freeze([
  "comet_connect",
  "comet_ask",
  "comet_poll",
  "comet_stop",
  "comet_screenshot",
  "comet_tabs",
  "comet_mode",
  "comet_upload",
]);

const GITHUB_REMOTE =
  /^(?:git@github\.com:|https:\/\/github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/;
const FULL_SHA = /^[0-9a-f]{40}$/;
const PINNED_SPEC = /^github:[^#]+#([0-9a-f]{40})$/;

/**
 * `owner/repo` of a GitHub remote URL, SSH or HTTPS.
 * @param {string} remoteUrl
 * @returns {string}
 */
export function githubSlug(remoteUrl) {
  const match = GITHUB_REMOTE.exec(remoteUrl.trim());
  if (!match) throw new Error(`${remoteUrl} is not a GitHub repository`);
  return match[1];
}

/** @param {string} text */
export const isFullSha = (text) => FULL_SHA.test(text);

/**
 * The `npx` package spec that runs `owner/repo` at a commit.
 * @param {string} slug
 * @param {string} sha
 */
export const bridgeSpec = (slug, sha) => `github:${slug}#${sha}`;

/**
 * @typedef {{ type?: string, command?: string, args?: string[],
 *   env?: Record<string, string> }} BridgeEntry
 */

/**
 * The user-scope `comet-bridge` entry in the text of `~/.claude.json`, which
 * keeps user-scope servers under its top-level `mcpServers` key, or null.
 * @param {string} claudeJson
 * @returns {BridgeEntry | null}
 */
export function bridgeEntryIn(claudeJson) {
  const config = JSON.parse(claudeJson);
  return config?.mcpServers?.[BRIDGE_NAME] ?? null;
}

/**
 * The commit an entry that runs `npx -y github:owner/repo#<sha>` is pinned
 * to, or null for any other entry.
 * @param {BridgeEntry | null} entry
 * @returns {string | null}
 */
export function pinnedSha(entry) {
  if (entry?.command !== "npx") return null;
  for (const arg of entry.args ?? []) {
    const match = PINNED_SPEC.exec(arg);
    if (match) return match[1];
  }
  return null;
}

/**
 * The port the new entry passes as `COMET_PORT`: the environment's, else the
 * current entry's, else the server's default.
 * @param {NodeJS.ProcessEnv} env
 * @param {BridgeEntry | null} entry
 * @returns {string}
 */
export function bridgePort(env, entry) {
  return env.COMET_PORT ?? entry?.env?.COMET_PORT ?? SERVER_DEFAULT_PORT;
}

/**
 * The entry that runs a pinned build on a port, keeping every other variable
 * of the environment it replaces (`COMET_PATH`, `COMET_UPLOAD_ROOT`, ...).
 * @param {string} spec
 * @param {string} port
 * @param {Record<string, string>} [keptEnv]
 * @returns {BridgeEntry}
 */
export function bridgeEntry(spec, port, keptEnv = {}) {
  return {
    type: "stdio",
    command: "npx",
    args: ["-y", spec],
    env: { ...keptEnv, COMET_PORT: port },
  };
}

/**
 * The expected tools a build does not offer.
 * @param {readonly string[]} offered
 * @returns {string[]}
 */
export function missingTools(offered) {
  return BRIDGE_TOOLS.filter((tool) => !offered.includes(tool));
}
