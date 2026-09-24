/**
 * The live no-pro battery: drives the built server against the local Comet
 * with the checks that spend no Perplexity Pro queries, scores each against
 * the known failures, and exits non-zero when the battery fails.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  batteryPassed,
  reportLine,
  summaryLine,
} from "./lib/battery-score.mjs";
import { runNoProBattery } from "./lib/no-pro-checks.mjs";

const DIST_ENTRY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../dist/index.js",
);

function callWithin(client) {
  return (name, args, timeoutMs) =>
    Promise.race([
      client.callTool({ name, arguments: args }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`TIMEOUT after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
}

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: [DIST_ENTRY],
  });

  const client = new Client({ name: "no-pro-battery", version: "1.0.0" });
  await client.connect(transport);
  console.log("Server started.\n");

  const checks = await runNoProBattery(callWithin(client), (check) =>
    console.log(reportLine(check)),
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
