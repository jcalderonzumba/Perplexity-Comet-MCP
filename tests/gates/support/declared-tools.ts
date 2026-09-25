/**
 * The input schema of each tool the stdio server declares, read from the
 * `TOOLS` list in `src/index.ts`. The server starts its transport on import,
 * so this parses the source: each tool is an object literal, or the imported
 * `COMET_MODE_TOOL`. Anything else in the list fails loudly rather than
 * being skipped.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { COMET_MODE_TOOL } from "../../../src/core/mode-tool.js";

const INDEX = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../src/index.ts",
);

/** One declared parameter: its JSON Schema type and, if any, its allowed values. */
export interface DeclaredParameter {
  readonly type: "string" | "number" | "boolean";
  readonly enum?: readonly unknown[];
}

export interface DeclaredTool {
  readonly properties: Readonly<Record<string, DeclaredParameter>>;
  readonly required: readonly string[];
}

/** The tools that are imported rather than written out in the list. */
const IMPORTED_TOOLS: Readonly<Record<string, unknown>> = { COMET_MODE_TOOL };

/** The value of a literal: strings, numbers, booleans, arrays and objects. */
function literalValue(node: ts.Expression): unknown {
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) {
    return literalValue(node.expression);
  }
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map(literalValue);
  }
  if (ts.isObjectLiteralExpression(node)) {
    return Object.fromEntries(node.properties.map(literalProperty));
  }
  throw new Error(`not a literal in TOOLS: ${node.getText()}`);
}

function literalProperty(
  property: ts.ObjectLiteralElementLike,
): [string, unknown] {
  if (
    !ts.isPropertyAssignment(property) ||
    !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
  ) {
    throw new Error(`not a plain property in TOOLS: ${property.getText()}`);
  }
  return [property.name.text, literalValue(property.initializer)];
}

function toolValue(element: ts.Expression): unknown {
  if (ts.isIdentifier(element)) {
    const imported = IMPORTED_TOOLS[element.text];
    if (imported === undefined) {
      throw new Error(`unknown tool in TOOLS: ${element.text}`);
    }
    return imported;
  }
  return literalValue(element);
}

/** The `TOOLS` array literal in the server's source. */
function toolsList(): ts.ArrayLiteralExpression {
  const source = ts.createSourceFile(
    INDEX,
    readFileSync(INDEX, "utf8"),
    ts.ScriptTarget.ES2022,
    true,
  );
  let list: ts.ArrayLiteralExpression | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "TOOLS" &&
      node.initializer !== undefined &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      list = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (list === undefined) throw new Error("no TOOLS array in src/index.ts");
  return list;
}

/** Every tool the stdio server declares, by name. */
export function declaredTools(): Map<string, DeclaredTool> {
  const tools = new Map<string, DeclaredTool>();
  for (const element of toolsList().elements) {
    const tool = toolValue(element) as {
      name: string;
      inputSchema: {
        properties?: Record<string, DeclaredParameter>;
        required?: string[];
      };
    };
    tools.set(tool.name, {
      properties: tool.inputSchema.properties ?? {},
      required: tool.inputSchema.required ?? [],
    });
  }
  return tools;
}

/**
 * What is wrong with one call's arguments against the tool's declared
 * schema: an undeclared tool or parameter, a missing required one, a value
 * of another type or outside its allowed values. Empty when nothing is.
 */
export function schemaViolations(
  tools: ReadonlyMap<string, DeclaredTool>,
  name: string,
  args: Readonly<Record<string, unknown>>,
): string[] {
  const tool = tools.get(name);
  if (tool === undefined) return [`${name} is not a declared tool`];
  const missing = tool.required
    .filter((parameter) => !(parameter in args))
    .map((parameter) => `${name} needs ${parameter}`);
  const wrong = Object.entries(args).flatMap(([parameter, value]) => {
    const declared = tool.properties[parameter];
    if (declared === undefined) {
      return [`${name} declares no parameter ${parameter}`];
    }
    if (typeof value !== declared.type) {
      return [`${name}'s ${parameter} is a ${declared.type}, not ${value}`];
    }
    if (declared.enum !== undefined && !declared.enum.includes(value)) {
      return [`${name}'s ${parameter} does not allow ${value}`];
    }
    return [];
  });
  return [...missing, ...wrong];
}
