/**
 * The input schema of each tool the servers declare, read from the tool
 * table's definitions (`TOOL_DEFINITIONS`), the one list both adapters
 * answer `tools/list` from.
 */
import { TOOL_DEFINITIONS } from "../../../src/core/tools.js";

/** One declared parameter: its JSON Schema type and, if any, its allowed values. */
export interface DeclaredParameter {
  readonly type: "string" | "number" | "boolean";
  readonly enum?: readonly unknown[];
}

export interface DeclaredTool {
  readonly properties: Readonly<Record<string, DeclaredParameter>>;
  readonly required: readonly string[];
}

/** Every tool the servers declare, by name. */
export function declaredTools(): Map<string, DeclaredTool> {
  return new Map(
    TOOL_DEFINITIONS.map((tool) => [
      tool.name,
      {
        properties: (tool.inputSchema.properties ?? {}) as Readonly<
          Record<string, DeclaredParameter>
        >,
        required: tool.inputSchema.required ?? [],
      },
    ]),
  );
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
