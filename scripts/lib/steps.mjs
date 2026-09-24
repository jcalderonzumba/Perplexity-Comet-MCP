/** The steps the local gates run, shared so `preflight` runs everything `check` does. */

/** @typedef {{ title: string, command: string, args: readonly string[] }} CommandStep */

/** @type {readonly CommandStep[]} */
export const CHECK_STEPS = [
  {
    title: "Lint and format (Biome)",
    command: "npx",
    args: ["--no-install", "biome", "check", "."],
  },
  {
    title: "Typecheck (src)",
    command: "npx",
    args: ["--no-install", "tsc", "--noEmit"],
  },
  {
    title: "Typecheck (tests and scripts)",
    command: "npx",
    args: ["--no-install", "tsc", "--noEmit", "-p", "tsconfig.tools.json"],
  },
  { title: "Tests", command: "npx", args: ["--no-install", "vitest", "run"] },
];
