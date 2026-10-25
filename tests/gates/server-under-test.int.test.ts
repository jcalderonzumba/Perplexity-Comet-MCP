/**
 * The battery's server parameters, used through the SDK's stdio transport
 * as `tests/run-no-pro.mjs` uses them, reach the spawned server: the port the
 * battery checks is the port the server under test reads. And the battery's
 * debug-port probe, asked against a loopback listener the test opens, answers
 * as the server's own check does.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runNoProBattery } from "../lib/no-pro-checks.mjs";
import {
  ALLOW_DIALOG_BOUND_MS,
  activePortFileText,
  type BrowserClient,
  type BrowserEndpoint,
  debugPort,
  type OpenBrowser,
  serverUnderTest,
} from "../lib/server-under-test.mjs";
import { fakeServer } from "./support/battery-replies.js";

const STAND_IN = fileURLToPath(
  new URL("./support/env-reporting-server.mjs", import.meta.url),
);

let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
});

async function portTheServerReads(env: Record<string, string>) {
  const server = serverUnderTest(STAND_IN, env);
  client = new Client({ name: "server-under-test", version: "1.0.0" });
  await client.connect(new StdioClientTransport(server.parameters));
  const reply = await client.callTool({ name: "comet-port", arguments: {} });
  const [content] = reply.content as { type: string; text: string }[];
  return { checked: server.port, read: content?.text };
}

describe("the server under test", () => {
  it("reads the COMET_PORT the battery checks", async () => {
    const { checked, read } = await portTheServerReads({ COMET_PORT: "9222" });
    expect(checked).toBe(9222);
    expect(read).toBe("9222");
  });

  it("reads the default port the battery checks when COMET_PORT is unset", async () => {
    const { checked, read } = await portTheServerReads({});
    expect(checked).toBe(9223);
    expect(read).toBe("9223");
  });
});

/**
 * A listener on 127.0.0.1 that answers `status` with `body` and records each
 * URL asked, as its `Host` header and path.
 */
async function loopbackListener(status: number, body = "{}") {
  const asked: string[] = [];
  const listener: Server = createServer((request, response) => {
    asked.push(`${request.headers.host}${request.url}`);
    response.writeHead(status, { "content-type": "application/json" });
    response.end(body);
  });
  await new Promise<void>((listening) =>
    listener.listen(0, "127.0.0.1", listening),
  );
  const { port } = listener.address() as AddressInfo;
  const close = () =>
    new Promise<void>((closed) => {
      listener.closeAllConnections();
      listener.close(() => closed());
    });
  return { port, asked, close };
}

/** No `DevToolsActivePort`: the battery finds Comet through the flag only. */
const NO_SWITCH = { activePortText: async () => null };

/** A loopback port nothing listens on: one the system gave out, then freed. */
async function portNothingListensOn() {
  const listener = await loopbackListener(200);
  await listener.close();
  return listener.port;
}

describe("the debug-port probe", () => {
  it("answers true when 127.0.0.1 answers 200 on /json/version", async () => {
    const listener = await loopbackListener(200);
    try {
      expect(await debugPort(listener.port, NO_SWITCH).answers()).toBe(true);
      expect(listener.asked).toEqual([
        `127.0.0.1:${listener.port}/json/version`,
      ]);
    } finally {
      await listener.close();
    }
  });

  it("answers false when 127.0.0.1 answers 404", async () => {
    const listener = await loopbackListener(404);
    try {
      expect(await debugPort(listener.port, NO_SWITCH).answers()).toBe(false);
    } finally {
      await listener.close();
    }
  });

  it("answers false when nothing listens on the port", async () => {
    const port = await portNothingListensOn();
    expect(await debugPort(port, NO_SWITCH).answers()).toBe(false);
  });
});

describe("the debug port's page list", () => {
  it("gives the address of each page target the port lists, and of nothing else", async () => {
    const listener = await loopbackListener(
      200,
      JSON.stringify([
        { type: "page", url: "https://www.perplexity.ai/search/a-thread" },
        { type: "iframe", url: "https://count.perplexity.ai/bs" },
        { type: "service_worker", url: "chrome-extension://x/sw.js" },
        { type: "page", url: "https://www.perplexity.ai/sidecar?copilot=true" },
      ]),
    );
    try {
      expect(await debugPort(listener.port, NO_SWITCH).pageAddresses()).toEqual(
        [
          "https://www.perplexity.ai/search/a-thread",
          "https://www.perplexity.ai/sidecar?copilot=true",
        ],
      );
      expect(listener.asked).toEqual([
        `127.0.0.1:${listener.port}/json/version`,
        `127.0.0.1:${listener.port}/json/list`,
      ]);
    } finally {
      await listener.close();
    }
  });

  it("rejects when the port does not answer with its list, so the check fails with the reason", async () => {
    const listener = await loopbackListener(500);
    try {
      await expect(
        debugPort(listener.port, NO_SWITCH).pageAddresses(),
      ).rejects.toThrow(/500/);
    } finally {
      await listener.close();
    }
  });
});

describe("the debug port's page visibility", () => {
  const TARGETS = JSON.stringify([
    {
      id: "sidecar-1",
      type: "page",
      url: "https://www.perplexity.ai/sidecar?copilot=true",
    },
    { id: "other-1", type: "page", url: "https://github.com/" },
    {
      id: "main-1",
      type: "page",
      url: "https://www.perplexity.ai/search/a-thread",
    },
  ]);

  /** A page connection that answers `value` to evaluations, recording them. */
  function fakePages(value: unknown) {
    const opened: string[] = [];
    const evaluated: string[] = [];
    let closed = 0;
    return {
      opened,
      evaluated,
      closed: () => closed,
      open: async (targetId: string) => {
        opened.push(targetId);
        return {
          Runtime: {
            evaluate: async ({ expression }: { expression: string }) => {
              evaluated.push(expression);
              return { result: { value } };
            },
          },
          close: async () => {
            closed += 1;
          },
        };
      },
    };
  }

  it("reads document.visibilityState of Perplexity's main page, not the sidecar or another page", async () => {
    const listener = await loopbackListener(200, TARGETS);
    const pages = fakePages("hidden");
    try {
      expect(
        await debugPort(listener.port, {
          ...NO_SWITCH,
          openPage: pages.open,
        }).pageVisibility(),
      ).toBe("hidden");
      expect(pages.opened).toEqual(["main-1"]);
      expect(pages.evaluated).toEqual(["document.visibilityState"]);
      expect(pages.closed()).toBe(1);
    } finally {
      await listener.close();
    }
  });

  it("is undefined when Comet has no main Perplexity page open", async () => {
    const listener = await loopbackListener(
      200,
      JSON.stringify([
        { id: "other-1", type: "page", url: "https://github.com/" },
      ]),
    );
    const pages = fakePages("hidden");
    try {
      expect(
        await debugPort(listener.port, {
          ...NO_SWITCH,
          openPage: pages.open,
        }).pageVisibility(),
      ).toBeUndefined();
      expect(pages.opened).toEqual([]);
    } finally {
      await listener.close();
    }
  });

  it("closes the connection it opened when the page does not answer", async () => {
    const listener = await loopbackListener(200, TARGETS);
    let closed = 0;
    const open = async () => ({
      Runtime: {
        evaluate: async () => {
          throw new Error("page gone");
        },
      },
      close: async () => {
        closed += 1;
      },
    });
    try {
      await expect(
        debugPort(listener.port, {
          ...NO_SWITCH,
          openPage: open,
        }).pageVisibility(),
      ).rejects.toThrow("page gone");
      expect(closed).toBe(1);
    } finally {
      await listener.close();
    }
  });
});

describe("the debug port through Comet's remote-debugging switch", () => {
  const PATH = "/devtools/browser/0b3f5c2e-8d1a-4e7b-9c6d-2a4f8e1b7c3d";
  const MAIN = "https://www.perplexity.ai/search/a-thread";
  const SIDECAR = "https://www.perplexity.ai/sidecar?copilot=true";
  const CLICK_LINE =
    "Comet is asking to allow remote debugging: click Allow in Comet (twice: once for the battery, once for the server).";

  /**
   * Comet's browser as the battery reaches it over its WebSocket: its
   * targets, one session per attach, and `value` for each evaluation.
   */
  function standInBrowser(value: unknown) {
    const opened: BrowserEndpoint[] = [];
    const sent: { method: string; params: unknown; sessionId?: string }[] = [];
    const client = {
      Target: {
        getTargets: async () => {
          sent.push({ method: "Target.getTargets", params: undefined });
          return {
            targetInfos: [
              { targetId: "sidecar-1", type: "page", url: SIDECAR },
              {
                targetId: "worker-1",
                type: "service_worker",
                url: "chrome-extension://x/sw.js",
              },
              { targetId: "main-1", type: "page", url: MAIN },
            ],
          };
        },
        attachToTarget: async (params: unknown) => {
          sent.push({ method: "Target.attachToTarget", params });
          return { sessionId: "session-1" };
        },
      },
      Runtime: {
        evaluate: async (params: unknown, sessionId?: string) => {
          sent.push({ method: "Runtime.evaluate", params, sessionId });
          return { result: { value } };
        },
      },
      close: async () => {},
    };
    return {
      opened,
      sent,
      open: async (endpoint: BrowserEndpoint) => {
        opened.push(endpoint);
        return client;
      },
    };
  }

  it("finds Comet when the flag does not answer and the file's port listens, and reads over one browser connection", async () => {
    const flag = await loopbackListener(404);
    const comets = await loopbackListener(200);
    const browser = standInBrowser("hidden");
    const said: string[] = [];
    try {
      const comet = debugPort(flag.port, {
        activePortText: async () => `${comets.port}\n${PATH}\n`,
        openBrowser: browser.open,
        say: (line: string) => said.push(line),
      });
      expect(await comet.answers()).toBe(true);
      expect(await comet.pageAddresses()).toEqual([SIDECAR, MAIN]);
      expect(await comet.pageVisibility()).toBe("hidden");
      expect(await comet.pageAddresses()).toEqual([SIDECAR, MAIN]);
      expect(await comet.pageVisibility()).toBe("hidden");

      expect(browser.opened).toEqual([{ port: comets.port, path: PATH }]);
      expect(
        browser.sent.filter(({ method }) => method === "Target.attachToTarget"),
      ).toEqual([
        {
          method: "Target.attachToTarget",
          params: { targetId: "main-1", flatten: true },
        },
      ]);
      expect(
        browser.sent.filter(({ method }) => method === "Runtime.evaluate"),
      ).toEqual(
        Array(2).fill({
          method: "Runtime.evaluate",
          params: { expression: "document.visibilityState" },
          sessionId: "session-1",
        }),
      );
      expect(said).toEqual([CLICK_LINE]);
      expect(flag.asked).toEqual([`127.0.0.1:${flag.port}/json/version`]);
      expect(comets.asked).toEqual([]);
    } finally {
      await flag.close();
      await comets.close();
    }
  });

  it("never reads the file when the flag answers", async () => {
    const flag = await loopbackListener(200);
    let reads = 0;
    try {
      const comet = debugPort(flag.port, {
        activePortText: async () => {
          reads += 1;
          return null;
        },
      });
      expect(await comet.answers()).toBe(true);
      expect(reads).toBe(0);
    } finally {
      await flag.close();
    }
  });

  it("does not find Comet when nothing listens on the file's port: no browser opened, nothing said", async () => {
    const flag = await loopbackListener(404);
    const stalePort = await portNothingListensOn();
    const browser = standInBrowser("hidden");
    const said: string[] = [];
    try {
      const comet = debugPort(flag.port, {
        activePortText: async () => `${stalePort}\n${PATH}\n`,
        openBrowser: browser.open,
        say: (line: string) => said.push(line),
      });
      expect(await comet.answers()).toBe(false);
      expect(browser.opened).toEqual([]);
      expect(said).toEqual([]);
    } finally {
      await flag.close();
    }
  });

  it("does not find Comet when the file is not Comet's", async () => {
    const flag = await loopbackListener(404);
    const comets = await loopbackListener(200);
    const browser = standInBrowser("hidden");
    try {
      const comet = debugPort(flag.port, {
        activePortText: async () =>
          `${comets.port}\n/devtools/page/0b3f5c2e-8d1a-4e7b-9c6d-2a4f8e1b7c3d\n`,
        openBrowser: browser.open,
        say: () => {},
      });
      expect(await comet.answers()).toBe(false);
      expect(browser.opened).toEqual([]);
    } finally {
      await flag.close();
      await comets.close();
    }
  });

  it("fails at [1.2] and calls no tool when neither the flag nor the switch answers", async () => {
    const port = await portNothingListensOn();
    const server = fakeServer({});
    const checks = await runNoProBattery(
      server.callTool,
      debugPort(port, NO_SWITCH),
    );
    expect(server.calls).toEqual([]);
    expect(checks[0]).toMatchObject({
      id: "1.2",
      verdict: "FAIL",
      note: `Comet is not running with its debug port on ${port}`,
    });
  });

  describe("while Comet's dialog for the battery waits", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /** A browser whose socket opens only when `answer` is called. */
    function unansweredBrowser() {
      let opened = 0;
      let answer: { allow(): void; deny(error: Error): void } = {
        allow: () => {},
        deny: () => {},
      };
      const client = standInBrowser("visible");
      return {
        opened: () => opened,
        answer: () => answer,
        open: (endpoint: BrowserEndpoint) => {
          opened += 1;
          return new Promise<BrowserClient>((allow, deny) => {
            answer = {
              allow: () => allow(client.open(endpoint)),
              deny,
            };
          });
        },
      };
    }

    async function switchFound(open: OpenBrowser) {
      const flag = await loopbackListener(404);
      const comets = await loopbackListener(200);
      const comet = debugPort(flag.port, {
        activePortText: async () => `${comets.port}\n${PATH}\n`,
        openBrowser: open,
        say: () => {},
      });
      expect(await comet.answers()).toBe(true);
      await flag.close();
      await comets.close();
      return comet;
    }

    it("fails the read at the bound, and the next read waits on the same socket", async () => {
      const browser = unansweredBrowser();
      const comet = await switchFound(browser.open);
      vi.useFakeTimers();

      const first = comet.pageAddresses();
      const failed = expect(first).rejects.toThrow(
        "Comet's allow dialog for the battery was not answered within 30 s",
      );
      await vi.advanceTimersByTimeAsync(ALLOW_DIALOG_BOUND_MS);
      await failed;

      const second = comet.pageAddresses();
      browser.answer().allow();
      expect(await second).toEqual([SIDECAR, MAIN]);
      expect(browser.opened()).toBe(1);
    });

    it("keeps a refusal that comes after the bound, opening no other socket", async () => {
      const browser = unansweredBrowser();
      const comet = await switchFound(browser.open);
      vi.useFakeTimers();

      const first = comet.pageAddresses();
      const failed = expect(first).rejects.toThrow(/not answered within 30 s/);
      await vi.advanceTimersByTimeAsync(ALLOW_DIALOG_BOUND_MS);
      await failed;
      browser.answer().deny(new Error("Unexpected server response: 403"));
      await vi.advanceTimersByTimeAsync(0);

      await expect(comet.pageVisibility()).rejects.toThrow("403");
      expect(browser.opened()).toBe(1);
    });
  });
});

describe("the battery's read of DevToolsActivePort", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "active-port-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("gives the text of a small regular file", async () => {
    const file = join(dir, "DevToolsActivePort");
    await writeFile(file, "9222\n/devtools/browser/x\n");
    expect(await activePortFileText(file)).toBe("9222\n/devtools/browser/x\n");
  });

  it("is null for no path, a missing file, a symlink, a directory and a 2 KiB file", async () => {
    const target = join(dir, "target");
    await writeFile(target, "9222\n/devtools/browser/x\n");
    await symlink(target, join(dir, "link"));
    await mkdir(join(dir, "directory"));
    await writeFile(join(dir, "large"), "9".repeat(2048));
    expect(await activePortFileText(null)).toBeNull();
    for (const name of ["missing", "link", "directory", "large"]) {
      expect(await activePortFileText(join(dir, name))).toBeNull();
    }
  });
});
