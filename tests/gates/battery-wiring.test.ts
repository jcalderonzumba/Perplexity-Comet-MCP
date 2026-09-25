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
  },
);

describe("the Pro battery", () => {
  const source = sourceOf("run-all.mjs");

  it("connects only through the connect check, which asks the port first", () => {
    expect(source).toContain("connectCheck(debugPort(server.port))");
    expect(source).not.toContain('"comet_connect"');
  });

  it("calls no other tool before the connect check, and none after it fails", () => {
    const connect = source.indexOf("connectCheck(debugPort(server.port))");
    const stop = source.indexOf("if (!connect.held)");
    expect(stop).toBeGreaterThan(connect);
    const firstToolCall = source.search(/await call\(\s*client,/);
    expect(firstToolCall).toBeGreaterThan(stop);
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

  it.each(["ok", "error", "modeReport", "key", "fakeServer"])(
    "define the reply builder %s once, in the shared test helper",
    (builder) => {
      expect(definersOf(builder)).toEqual(["gates/support/battery-replies.ts"]);
    },
  );
});
