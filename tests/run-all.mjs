/**
 * The live Pro battery: spawns the built MCP server (dist/index.js) on the
 * debug port it checks, drives the local Comet through it (README,
 * Development), scores each check against the Pro battery's own known
 * failures, and exits non-zero when the battery fails. Spends Perplexity Pro
 * queries. Comet must already answer on the server's port (COMET_PORT, 9223
 * by default): otherwise no tool is called.
 * Usage: npm run test:live:pro
 */

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  batteryPassed,
  reportLine,
  summaryLine,
} from "./lib/battery-score.mjs";
import { callWithin } from "./lib/call-within.mjs";
import { runProBattery, UPLOAD_TEST_FILE } from "./lib/pro-checks.mjs";
import { debugPort, serverUnderTest } from "./lib/server-under-test.mjs";

const DIST_ENTRY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../dist/index.js",
);

async function main() {
  writeFileSync(UPLOAD_TEST_FILE, "comet-mcp-test\n");

  const server = serverUnderTest(DIST_ENTRY, process.env);
  const transport = new StdioClientTransport(server.parameters);

  const client = new Client({ name: "pro-battery", version: "1.0.0" });
  await client.connect(transport);
  console.log("Server started.\n");

  const checks = await runProBattery(
    callWithin(client),
    debugPort(server.port),
    (check) => console.log(reportLine(check)),
  );

  console.log(`\n${"─".repeat(50)}`);
  console.log(summaryLine(checks));
  console.log(`${"─".repeat(50)}`);

  await client.close();
  process.exit(batteryPassed(checks) ? 0 : 1);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
