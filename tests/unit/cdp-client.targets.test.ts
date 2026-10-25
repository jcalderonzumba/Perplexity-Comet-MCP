import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeBrowser } from "./fakes/fake-browser.js";
import { answeringLaunch } from "./fakes/fake-comet-launch.js";

// Tabs are listed, opened and closed through the browser connection's
// Target domain on every platform: the client asks Comet's HTTP endpoints
// for nothing. Each platform branch is the client module loaded with the
// host it detects stubbed; the WSL check that the Windows side's port is
// reachable is a stub of `node:net`, so nothing here leaves the process.
const cdp = vi.hoisted(() => ({
  browser: null as unknown as { open(options: unknown): unknown },
  log: [] as string[],
  windowsReachable: true,
}));

vi.mock("chrome-remote-interface", () => ({
  default: Object.assign(
    async (options: unknown) => {
      cdp.log.push("socket opened");
      return cdp.browser.open(options);
    },
    { ProtocolError: class extends Error {} },
  ),
}));

/** `node:net` as the WSL check uses it: a connection that opens or fails. */
function fakeNet() {
  const createConnection = (
    options: { port: number; host: string },
    connected: () => void,
  ) => {
    cdp.log.push(`checked ${options.host}:${options.port}`);
    const handlers: Record<string, () => void> = {};
    queueMicrotask(() =>
      cdp.windowsReachable ? connected() : handlers.error?.(),
    );
    return {
      on: (event: string, handler: () => void) => {
        handlers[event] = handler;
      },
      setTimeout: () => {},
      destroy: () => {},
    };
  };
  return { createConnection, default: { createConnection } };
}

const PLATFORMS = [
  ["macOS and Linux", { wsl: false, windows: false }],
  ["Windows", { wsl: false, windows: true }],
  ["WSL", { wsl: true, windows: false }],
] as const;

const http = vi.fn(async () => {
  throw new Error("the client asked Comet's HTTP endpoints");
});

beforeEach(() => {
  http.mockClear();
  cdp.log.length = 0;
  cdp.windowsReachable = true;
  const browser = new FakeBrowser();
  browser.addTab({ id: "tab-1", type: "page", title: "", url: "about:blank" });
  cdp.browser = browser;
});

/** The client module as it loads on a host detected as `platform`. */
async function clientOn(platform: { wsl: boolean; windows: boolean }) {
  vi.resetModules();
  vi.doMock("../../src/host-platform.js", () => ({
    IS_WSL: platform.wsl,
    IS_WINDOWS: platform.windows,
    windowsFetch: http,
    psSingleQuote: (value: string) => value,
  }));
  vi.doMock("../../src/comet-launch.js", () => ({ systemCometLaunch: null }));
  vi.doMock("node:net", fakeNet);
  vi.stubGlobal("fetch", http);
  const { CometCDPClient } = await import("../../src/cdp-client.js");
  return new CometCDPClient({ port: 9222, launch: answeringLaunch() });
}

describe.each(PLATFORMS)("the client's tabs on %s", (_name, platform) => {
  it("lists, opens and closes tabs through the Target domain, with no HTTP request", async () => {
    const client = await clientOn(platform);

    await client.listTargets();
    const tab = await client.newTab("https://www.perplexity.ai/");
    await client.closeTab(tab.id);

    expect(http).not.toHaveBeenCalled();
    expect(cdp.log.filter((entry) => entry === "socket opened")).toHaveLength(
      1,
    );
  });
});

describe("the client's connection on WSL", () => {
  it("checks that Windows' 127.0.0.1 answers on the port before it opens the socket", async () => {
    const client = await clientOn({ wsl: true, windows: false });

    await client.listTargets();

    expect(cdp.log).toEqual(["checked 127.0.0.1:9222", "socket opened"]);
  });

  it("opens no socket and names mirrored networking when Windows' port cannot be reached", async () => {
    cdp.windowsReachable = false;
    const client = await clientOn({ wsl: true, windows: false });

    await expect(client.listTargets()).rejects.toThrow(
      "networkingMode=mirrored",
    );
    expect(cdp.log).toEqual(["checked 127.0.0.1:9222"]);
  });
});

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

/** Every TypeScript source under `src/`, by its path under it. */
function sources(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" }).filter(
    (file) => file.endsWith(".ts"),
  );
}

/** The `src/` files that name one of Comet's HTTP tab endpoints. */
function namingTabEndpoints(files: Record<string, string>): string[] {
  return Object.entries(files)
    .filter(([, text]) => /\/json\/(list|new|close)\b/.test(text))
    .map(([file]) => file);
}

describe("Comet's HTTP tab endpoints", () => {
  it("are named nowhere under src/", () => {
    const files = Object.fromEntries(
      sources().map((file) => [file, readFileSync(join(SRC, file), "utf8")]),
    );

    expect(namingTabEndpoints(files)).toEqual([]);
  });

  it.each(["/json/list", "/json/new?", "/json/close/"])(
    "would be caught naming %s",
    (endpoint) => {
      expect(
        namingTabEndpoints({
          "x.ts": `fetch(\`http://127.0.0.1:9222${endpoint}\`)`,
        }),
      ).toEqual(["x.ts"]);
    },
  );
});
