/**
 * The gate stamps under `.git/`: `review-ok`, written by the phase-reviewer
 * subagent, and `preflight-ok`, written by `npm run preflight`. Each lists the
 * commits its gate passed, one sha per line, and `.githooks/review-check.sh`
 * and `preflight-check.sh` pass when HEAD is among them, so parallel branches
 * in one clone never overwrite each other's stamp.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";

/**
 * The shas a stamp file lists; none when it does not exist.
 * @param {string} file
 * @returns {string[]}
 */
export function stampedShas(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * Adds `sha` to the stamp file, leaving every sha already in it.
 * @param {string} file
 * @param {string} sha
 */
export function addStamp(file, sha) {
  if (stampedShas(file).includes(sha)) return;
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  appendFileSync(file, `${separator}${sha}\n`, "utf8");
}
