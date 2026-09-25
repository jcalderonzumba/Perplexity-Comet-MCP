// Both live batteries start the server under test on the debug port they
// check, and ask that port before any tool can reach Comet: a tool call with
// nothing on the port would make the server launch Comet, or kill and
// relaunch one listening on another port. The battery scripts run on import,
// so this reads their source; the parameters themselves are pinned in
// `server-under-test.test.ts` and `server-under-test.int.test.ts`, the
// connect check in `no-pro-checks.test.ts`.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TESTS = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceOf(battery: string): string {
  return readFileSync(join(TESTS, battery), "utf8");
}

describe.each(["run-no-pro.mjs", "run-all.mjs"])(
  "the %s battery",
  (battery) => {
    const source = sourceOf(battery);

    it("starts the server with the parameters serverUnderTest gives", () => {
      expect(source).toMatch(
        /import \{[^}]*\bserverUnderTest\b[^}]*\} from "\.\/lib\/server-under-test\.mjs";/,
      );
      expect(source).toContain(
        "const server = serverUnderTest(DIST_ENTRY, process.env);",
      );
      expect(source).toContain("new StdioClientTransport(server.parameters)");
      expect(source.match(/new StdioClientTransport\(/g)).toHaveLength(1);
    });

    it("asks Comet on the server's port with the shared debug-port probe", () => {
      expect(source).toMatch(
        /import \{[^}]*\bdebugPort\b[^}]*\} from "\.\/lib\/server-under-test\.mjs";/,
      );
      expect(source).toContain("debugPort(server.port)");
      expect(source).not.toContain("/json/version");
    });

    it("calls tools only through callWithin, which gives the SDK each call's limit", () => {
      expect(source).toMatch(
        /import \{[^}]*\bcallWithin\b[^}]*\} from "\.\/lib\/call-within\.mjs";/,
      );
      expect(source).toContain("callWithin(client)");
      expect(source).not.toContain(".callTool(");
    });

    it("prints each check's verdict line and the summary from the scoring module", () => {
      expect(source).toMatch(
        /import \{[^}]*\breportLine\b[^}]*\bsummaryLine\b[^}]*\} from "\.\/lib\/battery-score\.mjs";/,
      );
      expect(source).toContain("console.log(reportLine(check))");
      expect(source).toContain("console.log(summaryLine(checks))");
    });

    it("fails the run on a FAIL or an UNEXPECTED PASS, and exits no other way but the fatal one", () => {
      expect(source).toMatch(
        /import \{[^}]*\bbatteryPassed\b[^}]*\} from "\.\/lib\/battery-score\.mjs";/,
      );
      expect(source.match(/process\.exit\((?:[^()]|\([^()]*\))*\)/g)).toEqual([
        "process.exit(batteryPassed(checks) ? 0 : 1)",
        "process.exit(1)",
      ]);
      expect(source).toMatch(
        /\.catch\(\(e\) => \{\s*console\.error\("Fatal:", e\);\s*process\.exit\(1\);\s*\}\);\s*$/,
      );
    });
  },
);

describe.each([
  [
    "no-pro",
    "lib/no-pro-checks.mjs",
    "NO_PRO_KNOWN_FAILURES",
    "PRO_KNOWN_FAILURES",
  ],
  ["Pro", "run-all.mjs", "PRO_KNOWN_FAILURES", "NO_PRO_KNOWN_FAILURES"],
])("the %s battery's scoring", (_battery, scorer, ownList, otherList) => {
  const source = sourceOf(scorer);

  it("scores against its own known-failures list, never the other battery's", () => {
    expect(source).toMatch(
      new RegExp(
        `import \\{[^}]*\\b${ownList}\\b[^}]*\\} from "\\./(?:lib/)?battery-score\\.mjs";`,
      ),
    );
    const scorings = source.match(/\bscoreCheck\([^;]*;/g) ?? [];
    expect(scorings.length).toBeGreaterThan(0);
    for (const call of scorings) {
      expect(call).toMatch(new RegExp(`\\b${ownList}\\b`));
    }
    expect(source).not.toMatch(new RegExp(`(?<![A-Z_])${otherList}\\b`));
  });
});

describe("the Pro battery", () => {
  const source = sourceOf("run-all.mjs");

  it("connects only through the connect check, which asks the port first", () => {
    expect(source).toContain("connectCheck(debugPort(server.port))");
    expect(source).not.toContain('"comet_connect"');
  });

  it("calls no other tool before the connect check, and none after it fails", () => {
    const connect = source.indexOf("connectCheck(debugPort(server.port))");
    const stop = source.indexOf('if (connect.verdict !== "PASS")');
    expect(stop).toBeGreaterThan(connect);
    const firstToolCall = source.search(/callTool\(\s*"/);
    expect(firstToolCall).toBeGreaterThan(stop);
  });

  it("runs every check through runCheck and scores it against the Pro list", () => {
    expect(source).toMatch(
      /import \{[^}]*\brunCheck\b[^}]*\bscoreCheck\b[^}]*\} from "\.\/lib\/battery-score\.mjs";/,
    );
    expect(source).toContain(
      "scoreCheck(await runCheck(id, probe), PRO_KNOWN_FAILURES)",
    );
    expect(source.match(/\brunCheck\(/g)).toHaveLength(1);
    expect(source.match(/\bscoreCheck\(/g)).toHaveLength(1);
  });

  it("keeps no verdicts or counters of its own", () => {
    expect(source).not.toMatch(/✅|❌|⏭|\bSKIP\b/);
    expect(source).not.toMatch(/\bfunction log\(/);
    expect(source).not.toMatch(/\b(?:passed|failed|skipped)\+\+/);
  });

  it("has no call(client, …) forwarding to callWithin", () => {
    expect(source).not.toMatch(/\bcall\(\s*client\b/);
    expect(source).not.toMatch(/\bfunction call\(/);
  });

  it("judges its screenshots with the no-pro battery's predicate", () => {
    expect(source).toMatch(
      /import \{[^}]*\bhasScreenshot\b[^}]*\} from "\.\/lib\/no-pro-checks\.mjs";/,
    );
    expect(source.match(/hasScreenshot\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).not.toMatch(/c\.type === "image"/);
  });

  it("runs the research workflow check", () => {
    expect(source).toMatch(
      /import \{[^}]*\bRESEARCH_WORKFLOW\b[^}]*\} from "\.\/lib\/pro-checks\.mjs";/,
    );
    expect(source).toContain("RESEARCH_WORKFLOW.probe(");
  });
});

describe("the batteries' helpers", () => {
  const BATTERY_SOURCES = [
    "run-no-pro.mjs",
    "run-all.mjs",
    "lib/battery-score.mjs",
    "lib/call-within.mjs",
    "lib/no-pro-checks.mjs",
    "lib/pro-checks.mjs",
    "lib/server-under-test.mjs",
    "gates/battery-score.test.ts",
    "gates/battery-wiring.test.ts",
    "gates/call-within.test.ts",
    "gates/no-pro-checks.test.ts",
    "gates/pro-checks.test.ts",
    "gates/support/battery-replies.ts",
  ];

  /** The files among the batteries' sources that define `name`. */
  function definersOf(name: string): string[] {
    const definition = new RegExp(
      `(?:function\\s+${name}\\s*\\(|(?:const|let)\\s+${name}\\s*[:=])`,
    );
    return BATTERY_SOURCES.filter((file) => definition.test(sourceOf(file)));
  }

  it.each(["replyText", "excerpt"])(
    "define the reply reader %s once, with the predicates",
    (reader) => {
      expect(definersOf(reader)).toEqual(["lib/no-pro-checks.mjs"]);
    },
  );

  it("define no reply reader of their own under another name", () => {
    expect(definersOf("text")).toEqual([]);
  });

  it.each(["ok", "error", "modeReport", "key", "fakeServer"])(
    "define the reply builder %s once, in the shared test helper",
    (builder) => {
      expect(definersOf(builder)).toEqual(["gates/support/battery-replies.ts"]);
    },
  );
});
