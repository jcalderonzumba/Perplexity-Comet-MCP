import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { capture, run } from "../../scripts/lib/gate.mjs";
import { repoRoot, runProcess } from "./support/git-sandbox.ts";

const gateModule = pathToFileURL(
  join(repoRoot, "scripts", "lib", "gate.mjs"),
).href;

/** Runs a tiny gate script through node and returns its outcome. */
function gateWith(steps: string) {
  const script = `
    import { Gate } from ${JSON.stringify(gateModule)};
    const gate = new Gate("test gate");
    ${steps}
    gate.finish(() => console.log("on success"));
  `;
  return runProcess("node", ["--input-type=module", "-e", script], {
    env: { NO_COLOR: "1" },
  });
}

describe("run", () => {
  it("returns the command's exit code", () => {
    expect(run("node", ["-e", "process.exit(3)"])).toBe(3);
  });

  it("returns 1 when the command cannot start", () => {
    expect(run("no-such-command-comet-mcp", [])).toBe(1);
  });

  it("stops a command at its timeout and returns 1", () => {
    const started = Date.now();
    expect(
      run("node", ["-e", "setTimeout(() => {}, 20000)"], { timeoutMs: 300 }),
    ).toBe(1);
    expect(Date.now() - started).toBeLessThan(10000);
  });
});

describe("capture", () => {
  it("returns the command's standard output", () => {
    expect(capture("node", ["-e", "process.stdout.write('out')"])).toBe("out");
  });

  it("throws, naming the command and its error, when it exits non-zero", () => {
    expect(() =>
      capture("node", ["-e", "console.error('broken'); process.exit(2)"]),
    ).toThrow(/^node -e .* failed: broken$/);
  });

  it("throws, naming the command, when it cannot start", () => {
    expect(() => capture("no-such-command-comet-mcp", ["--flag"])).toThrow(
      /^no-such-command-comet-mcp --flag failed: /,
    );
  });

  it("passes the given environment to the command", () => {
    expect(
      capture("node", ["-e", "process.stdout.write(process.env.PROBE ?? '')"], {
        env: { PROBE: "given" },
      }),
    ).toBe("given");
  });
});

describe("Gate", () => {
  it("passes when every step passes, and runs the success hook", () => {
    const outcome = gateWith(
      'gate.step("one", () => 0); gate.step("two", () => 0);',
    );
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain("PASS one");
    expect(outcome.stdout).toContain("PASS two");
    expect(outcome.stdout).toContain("test gate passed");
    expect(outcome.stdout).toContain("on success");
  });

  it("runs every step after a failure and names each failed step", () => {
    const outcome = gateWith(
      'gate.step("one", () => 2); gate.step("two", () => 0); gate.step("three", () => { throw new Error("boom"); });',
    );
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toContain("PASS two");
    expect(outcome.stdout).toContain("three threw: boom");
    expect(outcome.stdout).toContain("test gate FAILED");
    expect(outcome.stdout).toContain("one, three");
    expect(outcome.stdout).not.toContain("on success");
  });

  it("fails, naming the error, when the success hook throws", () => {
    const script = `
      import { Gate } from ${JSON.stringify(gateModule)};
      const gate = new Gate("test gate");
      gate.step("one", () => 0);
      gate.finish(() => { throw new Error("could not record"); });
    `;
    const outcome = runProcess("node", ["--input-type=module", "-e", script], {
      env: { NO_COLOR: "1" },
    });
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toContain(
      "FAIL recording the result: could not record",
    );
    expect(outcome.stdout).toContain("test gate FAILED");
    expect(outcome.stdout).not.toContain("test gate passed");
  });
});
