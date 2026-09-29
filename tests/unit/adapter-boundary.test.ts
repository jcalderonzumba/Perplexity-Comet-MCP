// Boundary 1: an adapter keeps only its transport. The stdio server
// (`index.ts`, `stdio-server.ts`) and the HTTP bridge (`http-bridge.ts`,
// `bridge-server.ts`) import the composition, the reply renderers, the
// UNTRUSTED wrapper, the error wording, the package version, the tool
// table's types and their transport's library, and nothing else: never the
// CDP client, the Comet module, a core's port or the page scripts. Whatever
// they would need of the browser is the table's to answer.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ADAPTER_FILES } from "./support/adapter-files.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

/** The project's own modules an adapter may import. */
const ALLOWED_OWN_MODULES = [
  "./cdp-tools.js",
  "./tool-results.js",
  "./untrusted.js",
  "./error-message.js",
  "./package-version.js",
  "./stdio-server.js",
  "./bridge-server.js",
  // The table's and the reply's types: the core the adapters sit outside of.
  "./core/tools.js",
  "./core/tool-reply.js",
];

/** The libraries an adapter's transport is built on. */
const TRANSPORT_LIBRARIES = [/^@modelcontextprotocol\/sdk\//, /^node:/];

/** Every module specifier a source imports, statically or dynamically. */
function importsOf(source: string): string[] {
  const specifier = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;
  return [...source.matchAll(specifier)].map((match) => match[1]);
}

/** The imports of `source` an adapter may not have. */
function forbiddenImports(source: string): string[] {
  return importsOf(source).filter(
    (module) =>
      !ALLOWED_OWN_MODULES.includes(module) &&
      !TRANSPORT_LIBRARIES.some((library) => library.test(module)),
  );
}

describe("importsOf", () => {
  it("reads static, side-effect, dynamic and type imports", () => {
    const source = [
      'import { a } from "./a.js";',
      'import type { B } from "./b.js";',
      'import "./c.js";',
      'const d = await import("./d.js");',
      "export { e } from './e.js';",
    ].join("\n");

    expect(importsOf(source)).toEqual([
      "./a.js",
      "./b.js",
      "./c.js",
      "./d.js",
      "./e.js",
    ]);
  });
});

describe("forbiddenImports", () => {
  it("allows the composition, the renderers and the transport's libraries", () => {
    const source = [
      'import { createCdpTools } from "./cdp-tools.js";',
      'import { toStdioResult } from "./tool-results.js";',
      'import { Server } from "@modelcontextprotocol/sdk/server/index.js";',
      'import http from "node:http";',
    ].join("\n");

    expect(forbiddenImports(source)).toEqual([]);
  });

  it("refuses an import of the CDP client", () => {
    const source = 'import { cometClient } from "./cdp-client.js";';

    expect(forbiddenImports(source)).toEqual(["./cdp-client.js"]);
  });

  it.each([
    'import CDP from "chrome-remote-interface";',
    'import { cometAI } from "./comet-ai.js";',
    'import { AskCore } from "./core/ask.js";',
    'import { validateUploadPath } from "./upload-validator.js";',
    'const client = await import("./cdp-client.js");',
    'import { readFileSync } from "fs";',
  ])("refuses %s", (source) => {
    expect(forbiddenImports(source)).toHaveLength(1);
  });
});

describe.each(ADAPTER_FILES)("the adapter file %s", (file) => {
  it("imports only the composition, the renderers and its transport", () => {
    const source = readFileSync(join(SRC, file), "utf8");

    expect(forbiddenImports(source)).toEqual([]);
  });
});
