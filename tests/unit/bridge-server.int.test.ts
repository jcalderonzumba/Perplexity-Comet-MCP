// The HTTP bridge adapter over a fake table, on a loopback port the test
// picks: what it keeps (the token, CORS, its routes and their status codes)
// and that a call reaches the table only with the right token (principle 4).

import { readFileSync } from "node:fs";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createBridgeServer } from "../../src/bridge-server.js";
import { TOOL_DEFINITIONS } from "../../src/core/tools.js";
import { packageVersion } from "../../src/package-version.js";
import { scriptedTable } from "./fakes/scripted-tool-table.js";

const TOKEN = "s3cret-token-value";
const SAME_LENGTH = "x".repeat(TOKEN.length);
const OTHER_LENGTH = "short";

const open: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    open
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

async function bridge(corsOrigin: string | null = null) {
  const scripted = scriptedTable();
  const server = createBridgeServer({
    table: scripted.table,
    token: TOKEN,
    corsOrigin,
    version: packageVersion(),
  });
  open.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { ...scripted, url: `http://127.0.0.1:${port}` };
}

function call(
  url: string,
  init: { method?: string; token?: string; body?: unknown } = {},
) {
  return fetch(url, {
    method: init.method ?? "GET",
    headers: {
      ...(init.token === undefined ? {} : { Authorization: init.token }),
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

describe("the routes that need no token", () => {
  it("answers GET /health with the version in package.json", async () => {
    const { url } = await bridge();

    const response = await call(`${url}/health`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "ok", version: packageVersion() });
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    expect(packageVersion()).toBe(
      JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version,
    );
  });

  it("answers GET / with the same version and the endpoints", async () => {
    const { url } = await bridge();

    const body = (await (await call(`${url}/`)).json()) as Record<
      string,
      unknown
    >;

    expect(body).toMatchObject({
      name: "comet-bridge",
      version: packageVersion(),
    });
    expect(body.endpoints).toHaveProperty("POST /tool/:name");
  });
});

describe("every other route", () => {
  const ROUTES: [string, string, unknown?][] = [
    ["GET", "/tools"],
    ["POST", "/tool/comet_ask", { prompt: "x" }],
    ["POST", "/rpc", { method: "comet_poll" }],
    ["GET", "/nowhere"],
  ];

  it.each(ROUTES)(
    "answers %s %s 401 with no token",
    async (method, path, body) => {
      const { url, calls } = await bridge();

      const response = await call(url + path, { method, body });

      expect(response.status).toBe(401);
      expect(calls).toEqual([]);
    },
  );

  it.each([
    ["a wrong token of the same length", SAME_LENGTH],
    ["a wrong token of another length", OTHER_LENGTH],
    ["an empty token", ""],
  ])("answers 401 with %s, the table untouched", async (_name, token) => {
    const { url, calls } = await bridge();

    for (const [method, path, body] of ROUTES) {
      const response = await call(url + path, { method, token, body });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
    expect(calls).toEqual([]);
  });

  it("reaches the table with the right token, bare or as a bearer", async () => {
    const { url, calls } = await bridge();

    const bare = await call(`${url}/tool/comet_ask`, {
      method: "POST",
      token: TOKEN,
      body: { prompt: "x" },
    });
    const bearer = await call(`${url}/rpc`, {
      method: "POST",
      token: `Bearer ${TOKEN}`,
      body: { method: "comet_poll", params: {} },
    });

    expect(bare.status).toBe(200);
    expect(bearer.status).toBe(200);
    expect(calls.map((c) => c.name)).toEqual(["comet_ask", "comet_poll"]);
  });
});

describe("the routes behind the token", () => {
  it("lists the table's eight tools, each with its description and input schema", async () => {
    const { url } = await bridge();

    const response = await call(`${url}/tools`, { token: TOKEN });
    const { tools } = (await response.json()) as {
      tools: { name: string; description: string; inputSchema: unknown }[];
    };

    expect(tools).toHaveLength(8);
    expect(tools).toEqual(JSON.parse(JSON.stringify(TOOL_DEFINITIONS)));
  });

  it("answers a text reply 200 as success with its words", async () => {
    const { url } = await bridge();

    const response = await call(`${url}/tool/comet_stop`, {
      method: "POST",
      token: TOKEN,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      content: "comet_stop answered",
    });
  });

  it("answers an error reply 400 with its words in error", async () => {
    const { url } = await bridge();

    const response = await call(`${url}/tool/comet_stop`, {
      method: "POST",
      token: TOKEN,
      body: { reply: "error" },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      content: "",
      error: "comet_stop refused",
    });
  });

  it("answers an unknown tool 400, in the table's words", async () => {
    const { url } = await bridge();

    const response = await call(`${url}/rpc`, {
      method: "POST",
      token: TOKEN,
      body: { method: "comet_click" },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Error: Unknown tool: comet_click",
    });
  });

  it("asks for a method on /rpc, and 404s an unknown route", async () => {
    const { url } = await bridge();

    const rpc = await call(`${url}/rpc`, {
      method: "POST",
      token: TOKEN,
      body: {},
    });
    const nowhere = await call(`${url}/nowhere`, { token: TOKEN });

    expect(rpc.status).toBe(400);
    expect(nowhere.status).toBe(404);
  });
});

describe("CORS", () => {
  it("emits no CORS headers unless an origin is configured", async () => {
    const { url } = await bridge();

    const response = await call(`${url}/health`);

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("emits the configured origin, never a wildcard, and answers a preflight", async () => {
    const { url } = await bridge("https://n8n.example.com");

    const preflight = await call(`${url}/tools`, { method: "OPTIONS" });

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(
      "https://n8n.example.com",
    );
  });
});
