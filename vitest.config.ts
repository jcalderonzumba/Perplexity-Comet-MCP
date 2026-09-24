import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/gates/**/*.test.ts"],
    setupFiles: ["tests/unit/jsdom-setup.ts"],
  },
});
