#!/usr/bin/env node
/**
 * `npm run bridge:update [-- <commit-sha>]`: points the user-scope
 * `comet-bridge` MCP server of Claude Code at this repository's build at a
 * commit, by default the tip of `main` on GitHub.
 *
 * It runs `npx -y github:<owner>/<repo>#<sha>` once first, which clones and
 * builds that commit into npx's cache, and asks the build for its tools. Only
 * a build that offers every tool replaces the entry, with `claude mcp`; if
 * adding the new entry fails, the previous one is put back. The new entry
 * keeps the current one's environment; its port is `COMET_PORT` from the
 * environment, else the current entry's, else the server's default. A new
 * Claude Code session runs the new build.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  BRIDGE_NAME,
  bridgeEntry,
  bridgeEntryIn,
  bridgePort,
  bridgeSpec,
  githubSlug,
  isFullSha,
  missingTools,
  pinnedSha,
} from "./lib/bridge.mjs";
import { toolsOffered } from "./lib/bridge-handshake.mjs";
import { capture, run } from "./lib/gate.mjs";

/** A failure the script explains itself, without a stack trace. */
class UpdateFailed extends Error {}

/** @typedef {import("./lib/bridge.mjs").BridgeEntry} BridgeEntry */

/** @param {string} sha */
const short = (sha) => sha.slice(0, 7);

/** @param {string | undefined} argument */
function requestedCommit(argument) {
  if (argument === undefined) return null;
  if (!isFullSha(argument))
    throw new UpdateFailed(
      `${argument} is not a full 40-character commit sha (lower case)`,
    );
  return argument;
}

function tipOfMain() {
  const line = capture("git", ["ls-remote", "origin", "refs/heads/main"]);
  const sha = line.split("\t")[0].trim();
  if (!isFullSha(sha))
    throw new UpdateFailed("origin has no main branch to pin to");
  return sha;
}

/** `~/.claude.json`, or the one in `CLAUDE_CONFIG_DIR` when that is set. */
function currentEntry() {
  const file = join(process.env.CLAUDE_CONFIG_DIR ?? homedir(), ".claude.json");
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  try {
    return bridgeEntryIn(text);
  } catch (error) {
    throw new UpdateFailed(
      `${file} is not valid JSON (${error instanceof Error ? error.message : String(error)}); ${BRIDGE_NAME} left unchanged`,
    );
  }
}

/**
 * @param {BridgeEntry} entry
 * @param {string} spec
 */
async function checkBuild(entry, spec) {
  /** @type {string[]} */
  let offered;
  try {
    offered = await toolsOffered(entry);
  } catch (error) {
    throw new UpdateFailed(
      `the build at ${spec} did not answer: ${error instanceof Error ? error.message : String(error)}\n${BRIDGE_NAME} left unchanged`,
    );
  }
  const missing = missingTools(offered);
  if (missing.length > 0)
    throw new UpdateFailed(
      `the build at ${spec} lacks ${missing.join(", ")}; ${BRIDGE_NAME} left unchanged`,
    );
}

/** @param {readonly string[]} args */
const claudeMcp = (args) => run("claude", ["mcp", ...args]) === 0;

/** @param {BridgeEntry} entry */
const addEntry = (entry) =>
  claudeMcp(["add-json", "-s", "user", BRIDGE_NAME, JSON.stringify(entry)]);

/**
 * @param {BridgeEntry | null} current
 * @param {BridgeEntry} next
 */
function replaceEntry(current, next) {
  if (current !== null && !claudeMcp(["remove", BRIDGE_NAME, "-s", "user"]))
    throw new UpdateFailed(
      `claude mcp remove failed; ${BRIDGE_NAME} left unchanged`,
    );
  if (addEntry(next)) return;
  if (current === null)
    throw new UpdateFailed(
      `claude mcp add-json failed; ${BRIDGE_NAME} is not configured`,
    );
  if (addEntry(current))
    throw new UpdateFailed(
      `claude mcp add-json failed; the previous ${BRIDGE_NAME} entry was restored`,
    );
  throw new UpdateFailed(
    `claude mcp add-json failed, and so did restoring the previous entry; add it back by hand: ${describeEntry(current)}`,
  );
}

/**
 * An entry's command line and the names of its variables, never their values,
 * which may be secrets.
 * @param {BridgeEntry} entry
 */
function describeEntry(entry) {
  const commandLine = [entry.command, ...(entry.args ?? [])].join(" ");
  const names = Object.keys(entry.env ?? {});
  return names.length === 0
    ? commandLine
    : `${commandLine}, with the environment variables ${names.join(", ")}`;
}

/**
 * @param {string | null} was
 * @param {BridgeEntry | null} current
 */
const described = (was, current) =>
  was !== null ? short(was) : current !== null ? "another build" : "none";

async function main() {
  const requested = requestedCommit(process.argv[2]);
  const slug = githubSlug(capture("git", ["remote", "get-url", "origin"]));
  const sha = requested ?? tipOfMain();
  const current = currentEntry();
  const was = pinnedSha(current);
  const port = bridgePort(process.env, current);
  // The port the entry runs on, which is the server's default when it sets none.
  if (was === sha && bridgePort({}, current) === port) {
    console.log(`${BRIDGE_NAME} already runs ${short(sha)}; nothing to do.`);
    return;
  }
  const spec = bridgeSpec(slug, sha);
  const next = bridgeEntry(spec, port, current?.env);
  console.log(
    `Building and checking ${spec} (the first start can take a minute)...`,
  );
  await checkBuild(next, spec);
  replaceEntry(current, next);
  console.log(
    `${BRIDGE_NAME}: ${described(was, current)} -> ${short(sha)}. ` +
      "Start a new Claude Code session to use it.",
  );
}

// Exits explicitly: after a build that closes before answering, the SDK's
// timer for the unanswered request, the build limit of five minutes, would
// keep the process alive until it runs out.
main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof UpdateFailed ? error.message : error);
    process.exit(1);
  },
);
