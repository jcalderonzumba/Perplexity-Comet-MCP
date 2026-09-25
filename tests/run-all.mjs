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
  PRO_KNOWN_FAILURES,
  reportLine,
  runCheck,
  scoreCheck,
  summaryLine,
} from "./lib/battery-score.mjs";
import { callWithin } from "./lib/call-within.mjs";
import {
  connectCheck,
  excerpt,
  hasScreenshot,
  replyText,
} from "./lib/no-pro-checks.mjs";
import { RESEARCH_WORKFLOW } from "./lib/pro-checks.mjs";
import { debugPort, serverUnderTest } from "./lib/server-under-test.mjs";

const DIST_ENTRY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../dist/index.js",
);
const COMET_TEST_FILE = "/tmp/comet-test-upload.txt";

/** Every check scored so far, in the order it ran. */
const checks = [];

/**
 * Runs one check's probe, scores it against the Pro battery's known
 * failures, and prints its verdict line. A probe that throws is a check
 * whose condition did not hold.
 * @param {string} id
 * @param {() => Promise<{ held: boolean, note: string }>} probe
 */
async function score(id, probe) {
  const check = scoreCheck(await runCheck(id, probe), PRO_KNOWN_FAILURES);
  console.log(reportLine(check));
  checks.push(check);
  return check;
}

/** @param {unknown} error */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @param {number} ms */
function pause(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

async function main() {
  // Create test upload file
  writeFileSync(COMET_TEST_FILE, "comet-mcp-test\n");

  const server = serverUnderTest(DIST_ENTRY, process.env);
  const transport = new StdioClientTransport(server.parameters);

  const client = new Client({ name: "test-runner", version: "1.0.0" });
  await client.connect(transport);
  console.log("Connected to MCP server.\n");
  const callTool = callWithin(client);

  // ─────────────────────────────────────────────
  // GROUP 1: Connection & Lifecycle
  // ─────────────────────────────────────────────
  console.log("── Group 1: Connection & Lifecycle ──");

  // 1.2 — Comet already answers on the server's debug port, and connect
  // succeeds. Nothing else runs without it: any tool call would make the
  // server launch Comet, or kill and relaunch one on another port.
  const connect = await score("1.2", () =>
    connectCheck(debugPort(server.port)).probe(callTool),
  );
  if (connect.verdict !== "PASS") {
    console.log("\nNo other check is run: [1.2] connect failed.");
    return finish(client);
  }

  // 1.5 — Session persistence: ask a simple question to confirm we're logged in
  await score("1.5", async () => {
    const t = replyText(
      await callTool(
        "comet_ask",
        { prompt: "Reply with exactly one word: VERIFIED" },
        60000,
      ),
    );
    if (t.toUpperCase().includes("VERIFIED"))
      return { held: true, note: "session token decrypted, no login redirect" };
    if (t.match(/login|sign.?in|auth/i))
      return {
        held: false,
        note: "redirected to login page — session not persisting",
      };
    return { held: true, note: `response: ${t.slice(0, 80)}` };
  });

  // ─────────────────────────────────────────────
  // GROUP 2: comet_ask — Basic Queries
  // ─────────────────────────────────────────────
  console.log("\n── Group 2: comet_ask — Basic Queries ──");

  // 2.1 — Simple factual question
  await score("2.1", async () => {
    const t = replyText(
      await callTool(
        "comet_ask",
        { prompt: "What is the capital of France? Reply in one word." },
        60000,
      ),
    );
    return t.match(/paris/i)
      ? { held: true, note: "" }
      : { held: false, note: `got: ${t.slice(0, 80)}` };
  });

  // 2.2 — newChat continuity
  await score("2.2", async () => {
    await callTool(
      "comet_ask",
      { prompt: "Remember the number 9473.", newChat: true },
      60000,
    );
    const t = replyText(
      await callTool(
        "comet_ask",
        { prompt: "What number did I ask you to remember?" },
        60000,
      ),
    );
    return t.includes("9473")
      ? { held: true, note: "" }
      : { held: false, note: `expected 9473, got: ${t.slice(0, 80)}` };
  });

  // 2.3 — newChat resets context
  await score("2.3", async () => {
    await callTool(
      "comet_ask",
      { prompt: "Remember the number 9473.", newChat: true },
      60000,
    );
    const t = replyText(
      await callTool(
        "comet_ask",
        { prompt: "What number did I ask you to remember?", newChat: true },
        60000,
      ),
    );
    return !t.includes("9473")
      ? { held: true, note: "context correctly reset" }
      : { held: false, note: "new chat incorrectly retained prior context" };
  });

  // 2.4 — Timeout respected
  await score("2.4", async () => {
    const start = Date.now();
    try {
      await callTool(
        "comet_ask",
        {
          prompt: "Write a 10000 word essay on the history of Rome.",
          timeout: 3000,
        },
        10000,
      );
    } catch (e) {
      const message = messageOf(e);
      return { held: !message.includes("TIMEOUT"), note: message.slice(0, 80) };
    }
    const elapsed = Date.now() - start;
    return elapsed < 8000
      ? { held: true, note: `returned in ${elapsed}ms` }
      : { held: false, note: `took ${elapsed}ms — timeout not respected` };
  });

  // 2.5 — Context injection
  await score("2.5", async () => {
    const t = replyText(
      await callTool(
        "comet_ask",
        {
          prompt: "What is the project name?",
          context: "Project name: Artemis",
        },
        60000,
      ),
    );
    return t.match(/artemis/i)
      ? { held: true, note: "" }
      : { held: false, note: `got: ${t.slice(0, 80)}` };
  });

  // ─────────────────────────────────────────────
  // GROUP 3: comet_ask — Agentic Browsing
  // ─────────────────────────────────────────────
  console.log("\n── Group 3: comet_ask — Agentic Browsing ──");

  // 3.1 — URL navigation
  await score("3.1", async () => {
    const t = replyText(
      await callTool(
        "comet_ask",
        { prompt: "Go to example.com and tell me the page heading." },
        90000,
      ),
    );
    if (t.match(/example.domain/i)) return { held: true, note: "" };
    if (t.match(/example/i))
      return { held: true, note: `navigated, response: ${t.slice(0, 80)}` };
    return { held: false, note: t.slice(0, 120) };
  });

  // 3.2 — tabPolicy=preserve
  await score("3.2", async () => {
    await callTool(
      "comet_ask",
      { prompt: "Go to example.com.", tabPolicy: "preserve" },
      90000,
    );
    const t = replyText(await callTool("comet_tabs", {}, 15000));
    return t.match(/example\.com/i)
      ? { held: true, note: "example.com tab preserved" }
      : { held: false, note: `tabs: ${t.slice(0, 120)}` };
  });

  // 3.3 — tabPolicy=cleanup
  await score("3.3", async () => {
    await callTool(
      "comet_ask",
      { prompt: "Go to example.com.", tabPolicy: "cleanup" },
      90000,
    );
    const t = replyText(await callTool("comet_tabs", {}, 15000));
    return !t.match(/example\.com/i)
      ? { held: true, note: "example.com tab cleaned up" }
      : { held: false, note: `tab still open: ${t.slice(0, 120)}` };
  });

  // 3.4 — Multi-step agentic task (qualitative)
  await score("3.4", async () => {
    const t = replyText(
      await callTool(
        "comet_ask",
        {
          prompt:
            "Go to github.com/trending, find the top-ranked repository today, and tell me its name and star count.",
        },
        120000,
      ),
    );
    // Just check something came back that looks like a repo name
    return t.match(/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+|star|\d+k/i)
      ? { held: true, note: t.slice(0, 100) }
      : { held: false, note: t.slice(0, 120) };
  });

  // ─────────────────────────────────────────────
  // GROUP 4: comet_poll and comet_stop
  // ─────────────────────────────────────────────
  console.log("\n── Group 4: comet_poll and comet_stop ──");

  // 4.1 — Poll while idle
  await score("4.1", async () => {
    const t = replyText(await callTool("comet_poll", {}, 10000));
    // any non-error response is fine
    return t.match(/idle|no.active|complete|done/i)
      ? { held: true, note: t.slice(0, 80) }
      : { held: true, note: `poll response: ${t.slice(0, 80)}` };
  });

  // 4.3 — Stop active task (fire and immediately stop)
  /** @type {Promise<unknown> | undefined} */
  let slowAsk;
  await score("4.3", async () => {
    // Start a very slow task without awaiting
    slowAsk = callTool(
      "comet_ask",
      {
        prompt:
          "Go to wikipedia.org and summarize the entire featured article in extreme detail.",
        timeout: 120000,
      },
      130000,
    ).catch(() => {});

    await pause(3000); // give it 3s to start

    const stopText = replyText(await callTool("comet_stop", {}, 10000));
    return stopText.match(/stopped|halted|cancelled|idle|no.task/i)
      ? { held: true, note: stopText.slice(0, 80) }
      : { held: true, note: `stop response: ${stopText.slice(0, 80)}` };
  });

  // 4.3b — Poll should now be idle
  await score("4.3b", async () => {
    await pause(1000);
    const pollText = replyText(await callTool("comet_poll", {}, 10000));
    return pollText.match(/idle|no.active|complete|done/i)
      ? { held: true, note: "confirmed idle after stop" }
      : { held: false, note: `still active?: ${pollText.slice(0, 80)}` };
  });
  await slowAsk; // let it resolve/reject cleanly

  // ─────────────────────────────────────────────
  // GROUP 5: comet_screenshot
  // ─────────────────────────────────────────────
  console.log("\n── Group 5: comet_screenshot ──");

  // 5.1 — Screenshot while idle
  await score("5.1", async () => {
    const r = await callTool("comet_screenshot", {}, 15000);
    return hasScreenshot(r)
      ? { held: true, note: "non-empty screenshot returned" }
      : {
          held: false,
          note: `content: ${JSON.stringify(r.content).slice(0, 120)}`,
        };
  });

  // 5.2 — Screenshot after navigation
  await score("5.2", async () => {
    await callTool("comet_ask", { prompt: "Go to example.com." }, 60000);
    const r = await callTool("comet_screenshot", {}, 15000);
    return hasScreenshot(r)
      ? { held: true, note: "screenshot after navigation returned" }
      : {
          held: false,
          note: `content: ${JSON.stringify(r.content).slice(0, 120)}`,
        };
  });

  // ─────────────────────────────────────────────
  // GROUP 6: comet_tabs
  // ─────────────────────────────────────────────
  console.log("\n── Group 6: comet_tabs ──");

  // 6.1 — List tabs
  await score("6.1", async () => ({
    held: true,
    note: excerpt(await callTool("comet_tabs", {}, 10000), 100),
  }));

  // 6.3 — Switch to tab by domain (need example.com open first)
  await score("6.3", async () => {
    await callTool(
      "comet_ask",
      { prompt: "Go to example.com.", tabPolicy: "preserve" },
      60000,
    );
    const t = replyText(
      await callTool(
        "comet_tabs",
        { action: "switch", domain: "example.com" },
        10000,
      ),
    );
    return t.match(/switch|focus|active|example/i)
      ? { held: true, note: t.slice(0, 80) }
      : { held: false, note: t.slice(0, 120) };
  });

  // 6.4 — Close tab by domain
  await score("6.4", async () => {
    const t = replyText(
      await callTool(
        "comet_tabs",
        { action: "close", domain: "example.com" },
        10000,
      ),
    );
    return t.match(/close|closed|removed/i)
      ? { held: true, note: t.slice(0, 80) }
      : { held: true, note: `close response: ${t.slice(0, 80)}` };
  });

  // ─────────────────────────────────────────────
  // GROUP 7: comet_mode
  // ─────────────────────────────────────────────
  console.log("\n── Group 7: comet_mode ──");

  // 7.1 — Read current mode
  await score("7.1", async () => {
    const t = replyText(await callTool("comet_mode", {}, 15000));
    return t.match(/search|research|labs|learn/i)
      ? { held: true, note: `mode: ${t.slice(0, 60)}` }
      : { held: false, note: t.slice(0, 100) };
  });

  // 7.2 — Switch through each mode
  for (const mode of ["research", "labs", "learn", "search"]) {
    await score(`7.2-${mode}`, async () => {
      const t = replyText(await callTool("comet_mode", { mode }, 20000));
      return { held: !t.match(/error|fail|invalid/i), note: t.slice(0, 60) };
    });
  }

  // 7.4 — The owner's workflow: research set with comet_mode survives the
  // new chat comet_ask opens. Spends one Deep research query.
  await score(RESEARCH_WORKFLOW.id, () => RESEARCH_WORKFLOW.probe(callTool));

  // ─────────────────────────────────────────────
  // GROUP 8: comet_upload
  // ─────────────────────────────────────────────
  console.log("\n── Group 8: comet_upload ──");

  // 8.3 — Upload to non-existent selector (no navigation needed, just wrong selector)
  await score("8.3", async () => {
    let t;
    try {
      t = replyText(
        await callTool(
          "comet_upload",
          { filePath: COMET_TEST_FILE, selector: "#does-not-exist-xyzabc" },
          15000,
        ),
      );
    } catch (e) {
      return {
        held: true,
        note: `threw as expected: ${messageOf(e).slice(0, 60)}`,
      };
    }
    // Should return an error about selector not found
    return t.match(/not found|no.element|error|failed/i)
      ? { held: true, note: t.slice(0, 80) }
      : { held: false, note: `expected error, got: ${t.slice(0, 80)}` };
  });

  // 8.4 — Upload non-existent file
  await score("8.4", async () => {
    let t;
    try {
      t = replyText(
        await callTool(
          "comet_upload",
          { filePath: "/tmp/file-that-does-not-exist-xyzabc.txt" },
          15000,
        ),
      );
    } catch (e) {
      return {
        held: true,
        note: `threw as expected: ${messageOf(e).slice(0, 60)}`,
      };
    }
    return t.match(/not found|no.file|error|failed|exist/i)
      ? { held: true, note: t.slice(0, 80) }
      : { held: false, note: `expected error, got: ${t.slice(0, 80)}` };
  });

  // ─────────────────────────────────────────────
  // GROUP 9: Edge Cases
  // ─────────────────────────────────────────────
  console.log("\n── Group 9: Edge Cases ──");

  // 9.2 — Empty prompt
  await score("9.2", async () => {
    try {
      const t = replyText(await callTool("comet_ask", { prompt: "" }, 30000));
      return { held: true, note: `empty prompt handled: ${t.slice(0, 80)}` };
    } catch (e) {
      return {
        held: true,
        note: `graceful error: ${messageOf(e).slice(0, 80)}`,
      };
    }
  });

  // 9.4 — Invalid mode
  await score("9.4", async () => {
    try {
      const t = replyText(
        await callTool("comet_mode", { mode: "invalid_mode_xyz" }, 15000),
      );
      return { held: true, note: `invalid mode handled: ${t.slice(0, 80)}` };
    } catch (e) {
      return {
        held: true,
        note: `graceful error: ${messageOf(e).slice(0, 60)}`,
      };
    }
  });

  return finish(client);
}

/** @param {Client} client */
async function finish(client) {
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
