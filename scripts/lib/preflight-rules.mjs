/** The rules `npm run preflight` judges with, kept pure so they are unit tested. */

/** The live no-pro battery's ceiling: long enough for a cold Comet, short enough to never hang. */
export const LIVE_BATTERY_TIMEOUT_MS = 600_000;

const REQUIRED = ["package.json", "dist/index.js", "README.md", "LICENSE"];

/**
 * What is wrong with the files `npm pack` would ship: anything outside the
 * build, the manifest, the README and the licence, and any of those missing.
 * @param {readonly string[]} files
 * @returns {string[]}
 */
export function packProblems(files) {
  const allowed = (/** @type {string} */ file) =>
    REQUIRED.includes(file) || file.startsWith("dist/");
  return [
    ...files
      .filter((file) => !allowed(file))
      .map((file) => `unexpected in the tarball: ${file}`),
    ...REQUIRED.filter((file) => !files.includes(file)).map(
      (file) => `missing from the tarball: ${file}`,
    ),
  ];
}

/**
 * The trees that are not clean, each with its `git status --porcelain` lines.
 * `work` is null in a clone without the notebook.
 * @param {{ public: string, work: string | null }} trees
 * @returns {string[]}
 */
export function dirtyTrees(trees) {
  /** @type {string[]} */
  const dirty = [];
  if (trees.public.trim() !== "") {
    dirty.push(`the working tree:\n${trees.public.trimEnd()}`);
  }
  if (trees.work !== null && trees.work.trim() !== "") {
    dirty.push(`.work/:\n${trees.work.trimEnd()}`);
  }
  return dirty;
}
