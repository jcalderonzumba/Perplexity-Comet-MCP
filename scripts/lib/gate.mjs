/** Shared helpers for the local gates (`npm run check`, `npm run preflight`). */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const useColor =
  process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
// Built at runtime so no raw control character ever lands in the source file.
const ESC = String.fromCharCode(27);
/** @param {string} code @param {string} text */
const paint = (code, text) =>
  useColor ? `${ESC}[${code}m${text}${ESC}[0m` : text;

/** @param {string} text */
export const heading = (text) =>
  process.stdout.write(`\n${paint("1", `> ${text}`)}\n`);
/** @param {string} text */
export const note = (text) =>
  process.stdout.write(`${paint("2", `  ${text}`)}\n`);
/** @param {string} text */
export const ok = (text) =>
  process.stdout.write(`${paint("32", `  PASS ${text}`)}\n`);
/** @param {string} text */
export const warn = (text) =>
  process.stdout.write(`${paint("33", `  WARN ${text}`)}\n`);
/** @param {string} text */
export const fail = (text) =>
  process.stdout.write(`${paint("31", `  FAIL ${text}`)}\n`);

/**
 * Runs a command, streaming its output. Returns the exit code. Never throws:
 * the gates decide what a non-zero code means. A command still running at
 * `timeoutMs` is killed and counts as a failure.
 * @param {string} command
 * @param {readonly string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number }} [options]
 * @returns {number}
 */
export function run(command, args, options = {}) {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd ?? repoRoot,
    stdio: "inherit",
    env: { ...process.env, ...options.env },
    shell: false,
    timeout: options.timeoutMs,
    killSignal: "SIGKILL",
  });
  if (result.error) {
    const timedOut =
      /** @type {NodeJS.ErrnoException} */ (result.error).code === "ETIMEDOUT";
    fail(
      timedOut
        ? `${command} timed out after ${Math.round((options.timeoutMs ?? 0) / 1000)}s`
        : `${command}: ${result.error.message}`,
    );
    return 1;
  }
  return result.status ?? 1;
}

/**
 * Runs a command and returns its standard output. Throws, naming the command,
 * when it cannot start or exits non-zero, so a failed read never passes for
 * empty output.
 * @param {string} command
 * @param {readonly string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {string}
 */
export function capture(command, args, options = {}) {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    shell: false,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${[command, ...args].join(" ")} failed: ${whyItFailed(result)}`,
    );
  }
  return result.stdout;
}

/**
 * @param {import("node:child_process").SpawnSyncReturns<string>} result
 * @returns {string}
 */
function whyItFailed(result) {
  if (result.error) return result.error.message;
  const stderr = result.stderr.trim();
  if (stderr !== "") return stderr;
  return result.signal
    ? `killed by ${result.signal}`
    : `exit code ${result.status}`;
}

/** @param {unknown} error */
const messageOf = (error) =>
  error instanceof Error ? error.message : String(error);

/** @typedef {number | "skipped"} StepOutcome */

/**
 * A gate is an ordered list of named steps. Each step runs to completion and
 * reports on its own, so one run names every step that failed.
 */
export class Gate {
  /** @type {string} */ #name;
  /** @type {string[]} */ #failures = [];
  /** @type {string[]} */ #skipped = [];
  #started = Date.now();

  /** @param {string} name */
  constructor(name) {
    this.#name = name;
  }

  /**
   * @param {string} title
   * @param {() => StepOutcome} body returns an exit code (0 passes) or "skipped"
   */
  step(title, body) {
    heading(title);
    const startedAt = Date.now();
    /** @type {StepOutcome} */
    let outcome;
    try {
      outcome = body();
    } catch (error) {
      fail(`${title} threw: ${messageOf(error)}`);
      this.#failures.push(title);
      return;
    }
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (outcome === "skipped") {
      this.#skipped.push(title);
      return;
    }
    if (outcome === 0) {
      ok(`${title} (${seconds}s)`);
      return;
    }
    fail(`${title} failed (${seconds}s)`);
    this.#failures.push(title);
  }

  get failed() {
    return this.#failures.length > 0;
  }

  /**
   * Prints the summary and exits the process with the right code.
   * @param {() => void} [onSuccess] records the gate's result; runs only when
   *   every step passed, and fails the gate if it throws
   * @returns {never}
   */
  finish(onSuccess) {
    if (this.#failures.length === 0) this.#recordResult(onSuccess);
    const seconds = ((Date.now() - this.#started) / 1000).toFixed(1);
    if (this.#failures.length > 0) {
      process.stdout.write(
        `\n${paint("31;1", `${this.#name} FAILED`)} in ${seconds}s - ${this.#failures.join(", ")}\n`,
      );
      process.exit(1);
    }
    if (this.#skipped.length > 0) note(`skipped: ${this.#skipped.join(", ")}`);
    process.stdout.write(
      `\n${paint("32;1", `${this.#name} passed`)} in ${seconds}s\n`,
    );
    process.exit(0);
  }

  /** @param {(() => void) | undefined} onSuccess */
  #recordResult(onSuccess) {
    try {
      onSuccess?.();
    } catch (error) {
      fail(`recording the result: ${messageOf(error)}`);
      this.#failures.push("recording the result");
    }
  }
}
