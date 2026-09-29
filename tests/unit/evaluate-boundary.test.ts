// Boundary 3: JavaScript run in the page lives in `src/page-scripts.ts` as
// tested functions that receive input as serialised arguments, never pasted
// into script text. The guard reads every source under `src/` and fails
// when:
//   - anything but `src/cdp-client.ts` calls `Runtime.evaluate`, or
//   - an expression handed to an evaluate (the client's `evaluate` and
//     `safeEvaluate`, or `Runtime.evaluate` inside the client) is neither a
//     call of `pageScriptExpression` nor a plain string literal, which holds
//     no input (the client's `1+1` health check, its `window.location.href`
//     read). A template literal with a substitution and a concatenation are
//     script text built from a value, and fail.
// The two client methods `evaluate` and `safeEvaluate` pass their parameter
// on to `Runtime.evaluate`: the one place an expression is a bare name, and
// the calls to them are what the guard checks.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const CLIENT = "cdp-client.ts";
const EVALUATES = ["evaluate", "safeEvaluate"];

interface Scan {
  /** How many evaluate calls were read. */
  readonly evaluates: number;
  /** One line for each rule broken, naming the file and the line. */
  readonly violations: string[];
}

/** Reads `source`, the text of `file` (a path under `src/`), against the rules. */
function scanEvaluates(file: string, source: string): Scan {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.ES2022,
    true,
  );
  const scan = { evaluates: 0, violations: [] as string[] };
  const where = (node: ts.Node) =>
    `${file}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isEvaluate(node.expression)) {
      scan.evaluates++;
      const problem = isRuntime(node.expression.expression)
        ? runtimeEvaluateProblem(file, node)
        : expressionProblem(node.arguments[0]);
      if (problem) scan.violations.push(`${where(node)}: ${problem}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return scan;
}

function isEvaluate(
  callee: ts.Expression,
): callee is ts.PropertyAccessExpression {
  return (
    ts.isPropertyAccessExpression(callee) &&
    EVALUATES.includes(callee.name.text)
  );
}

/** Whether `receiver` is `Runtime` or `<something>.Runtime`. */
function isRuntime(receiver: ts.Expression): boolean {
  return (
    (ts.isIdentifier(receiver) && receiver.text === "Runtime") ||
    (ts.isPropertyAccessExpression(receiver) &&
      receiver.name.text === "Runtime")
  );
}

/** What is wrong with a call of `Runtime.evaluate`, or null. */
function runtimeEvaluateProblem(
  file: string,
  call: ts.CallExpression,
): string | null {
  if (file !== CLIENT) return `Runtime.evaluate is called outside ${CLIENT}`;
  const options = call.arguments[0];
  if (!options || !ts.isObjectLiteralExpression(options)) {
    return "Runtime.evaluate is not given its options as an object literal";
  }
  const expression = options.properties.find(
    (property) =>
      property.name &&
      ts.isIdentifier(property.name) &&
      property.name.text === "expression",
  );
  if (!expression) return "Runtime.evaluate is given no expression";
  if (ts.isShorthandPropertyAssignment(expression)) {
    return withinEvaluateMethod(call)
      ? null
      : "Runtime.evaluate is given a bare name outside the client's evaluate methods";
  }
  return ts.isPropertyAssignment(expression)
    ? expressionProblem(expression.initializer)
    : "Runtime.evaluate is given an expression of a kind the guard does not read";
}

/** Whether `node` is inside the client's `evaluate` or `safeEvaluate` method. */
function withinEvaluateMethod(node: ts.Node): boolean {
  for (let up = node.parent; up; up = up.parent) {
    if (ts.isMethodDeclaration(up) && EVALUATES.includes(up.name.getText())) {
      return true;
    }
  }
  return false;
}

/** What is wrong with `expression` as script text, or null. */
function expressionProblem(expression: ts.Node | undefined): string | null {
  if (!expression) return "an evaluate is given no expression";
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return null;
  }
  if (
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "pageScriptExpression"
  ) {
    return null;
  }
  return `an evaluate is given script text that is neither a plain string literal nor a call of pageScriptExpression: ${expression.getText()}`;
}

describe("scanEvaluates", () => {
  const scan = (source: string, file = "somewhere.ts") =>
    scanEvaluates(file, source);

  it.each([
    [
      "a call of pageScriptExpression",
      "client.evaluate(pageScriptExpression(fn, 1));",
    ],
    [
      "the reconnecting evaluate on a call of it",
      "client.safeEvaluate(pageScriptExpression(fn));",
    ],
    ["a plain string literal", 'client.evaluate("window.location.href");'],
    ["a template literal with no substitution", "client.evaluate(`1+1`);"],
  ])("allows %s", (_case, source) => {
    expect(scan(source)).toEqual({ evaluates: 1, violations: [] });
  });

  it("allows the client's own health check and location read", () => {
    const source = [
      'await this.client.Runtime.evaluate({ expression: "1+1", timeout: 3000 });',
      'await this.client.Runtime.evaluate({ expression: "window.location.href" });',
    ].join("\n");

    expect(scan(source, CLIENT)).toEqual({ evaluates: 2, violations: [] });
  });

  it("allows the client's evaluate methods to pass their parameter on", () => {
    const source = `class C {
      async evaluate(expression: string) {
        return this.client.Runtime.evaluate({ expression, returnByValue: true });
      }
      async safeEvaluate(expression: string) {
        return this.client.Runtime.evaluate({ expression });
      }
    }`;

    expect(scan(source, CLIENT).violations).toEqual([]);
  });

  it("fails on a template literal with a substitution", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of a call the guard must refuse
    const { violations } = scan("client.evaluate(`(${script})(${input})`);");

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("neither a plain string literal");
  });

  it("fails on string concatenation", () => {
    const { violations } = scan('client.safeEvaluate("f(" + input + ")");');

    expect(violations).toHaveLength(1);
  });

  it("fails on an expression held in a variable", () => {
    expect(scan("client.evaluate(expression);").violations).toHaveLength(1);
  });

  it("fails on a Runtime.evaluate outside the client, whatever its expression", () => {
    const { violations } = scan(
      'await client.Runtime.evaluate({ expression: "1+1" });',
      "cdp-tools.ts",
    );

    expect(violations).toEqual([
      "cdp-tools.ts:1: Runtime.evaluate is called outside cdp-client.ts",
    ]);
  });

  it("fails on a template literal inside the client's Runtime.evaluate", () => {
    const source =
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of a call the guard must refuse
      "await this.client.Runtime.evaluate({ expression: `f(${selector})` });";

    expect(scan(source, CLIENT).violations).toHaveLength(1);
  });

  it("fails on a bare name in the client's Runtime.evaluate outside its evaluate methods", () => {
    const source = `class C {
      async uploadFile(expression: string) {
        return this.client.Runtime.evaluate({ expression });
      }
    }`;

    expect(scan(source, CLIENT).violations).toHaveLength(1);
  });

  it("fails on options it cannot read", () => {
    expect(
      scan("await this.client.Runtime.evaluate(options);", CLIENT).violations,
    ).toHaveLength(1);
  });
});

/** Every `.ts` file under `directory`, as paths relative to `src/`. */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [relative(SRC, path)] : [];
  });
}

describe("the sources under src/", () => {
  const scans = sourceFiles(SRC).map((file) =>
    scanEvaluates(file, readFileSync(join(SRC, file), "utf8")),
  );

  it("read some evaluate calls, so the guard is not vacuous", () => {
    expect(
      scans.reduce((sum, scan) => sum + scan.evaluates, 0),
    ).toBeGreaterThan(5);
  });

  it("run no script text built from a value, and call Runtime.evaluate only in the client", () => {
    expect(scans.flatMap((scan) => scan.violations)).toEqual([]);
  });
});
