// The composition: the tool table over the CDP client, the Comet module and
// the UNTRUSTED wrapper. The cores' own rules are pinned in `core/`; this
// pins what the composition itself holds: the connect, tabs and upload
// handlers (the stdio server's behaviour, which the bridge now shares).
// That the client, the wrapper and the configured port reach the cores is
// pinned in `cdp-tools.ask.test.ts` and `cdp-tools.tab.test.ts`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CdpToolsClient,
  type CdpToolsDeps,
  createCdpToolTable,
} from "../../src/cdp-tools.js";
import { TOOL_DEFINITIONS } from "../../src/core/tools.js";
import type { TabContext } from "../../src/types.js";
import { FakeCometLaunch } from "./fakes/fake-comet-launch.js";

const CONFIGURED_PORT = 9444;
const TAB_ID = "0a1b2c3d-1111-4222-8333-444455556666";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function target(id: string, url: string, type = "page") {
  return { id, type, title: id, url };
}

function tabContext(overrides: Partial<TabContext>): TabContext {
  return {
    id: TAB_ID,
    url: "https://example.com/",
    title: "Example",
    purpose: "reference",
    domain: "example.com",
    lastActivity: 0,
    ...overrides,
  };
}

/** A client whose methods all fail unless a test says what they answer. */
function clientWith(methods: Record<string, unknown>): CdpToolsClient {
  return new Proxy(methods, {
    get: (known, name: string) =>
      name in known
        ? known[name]
        : () => Promise.reject(new Error(`unexpected call: ${name}`)),
  }) as unknown as CdpToolsClient;
}

function deps(client: CdpToolsClient, launch: FakeCometLaunch): CdpToolsDeps {
  return {
    client,
    launch,
    comet: { getAgentStatus: vi.fn() },
    quotePage: (text) => `<<${text}>>`,
    port: CONFIGURED_PORT,
  };
}

/** Comet answers on the port, unless a test says otherwise. */
function answeringLaunch(): FakeCometLaunch {
  const launch = new FakeCometLaunch();
  launch.answering = "Comet/140.0";
  return launch;
}

function tableOver(
  methods: Record<string, unknown>,
  launch: FakeCometLaunch = answeringLaunch(),
) {
  return createCdpToolTable(deps(clientWith(methods), launch));
}

function textOf(reply: { kind: string } & Record<string, unknown>): string {
  expect(reply.kind).toBe("text");
  return reply.text as string;
}

describe("createCdpToolTable", () => {
  it("lists the eight tools in order and answers each of them", () => {
    const table = tableOver({});

    expect(table.definitions).toBe(TOOL_DEFINITIONS);
    expect(table.definitions.map((tool) => tool.name)).toHaveLength(8);
  });

  it("answers comet_screenshot with the client's PNG as an image reply", async () => {
    const screenshot = vi.fn().mockResolvedValue({ data: "cG5n" });

    const reply = await tableOver({ screenshot }).call(
      "comet_screenshot",
      undefined,
    );

    expect(screenshot).toHaveBeenCalledWith("png");
    expect(reply).toEqual({
      kind: "image",
      data: "cG5n",
      mimeType: "image/png",
    });
  });

  it("makes a client failure an error reply naming it", async () => {
    const screenshot = vi.fn().mockRejectedValue(new Error("not connected"));

    const reply = await tableOver({ screenshot }).call(
      "comet_screenshot",
      undefined,
    );

    expect(reply).toEqual({
      kind: "text",
      text: "Error: not connected",
      isError: true,
    });
  });

  it("quotes a page script's detail with the wrapper it was given", async () => {
    const { PageScriptFailed } = await import(
      "../../src/core/page-script-failed.js"
    );
    const screenshot = vi
      .fn()
      .mockRejectedValue(new PageScriptFailed("read failed", "page says hi"));

    const reply = await tableOver({ screenshot }).call(
      "comet_screenshot",
      undefined,
    );

    expect(textOf(reply as never)).toContain("<<page says hi>>");
  });
});

describe("comet_connect", () => {
  it("probes the configured port, never a fixed one, and names it", async () => {
    const launch = answeringLaunch();
    const table = tableOver(
      {
        connect: async () => "ok",
        listTargets: async () => [
          target("main", "https://www.perplexity.ai/search/x"),
        ],
      },
      launch,
    );

    const reply = await table.call("comet_connect", {});

    expect(launch.probes).toEqual([CONFIGURED_PORT]);
    expect(launch.launches).toEqual([]);
    expect(reply).toEqual({
      kind: "text",
      text: "Comet is running with the debug port 9444 (Comet/140.0).\nConnected to Perplexity",
      isError: false,
    });
  });

  it("launches Comet on the configured port when none runs", async () => {
    const launch = new FakeCometLaunch();
    const table = tableOver(
      {
        connect: async () => "ok",
        listTargets: async () => [
          target("main", "https://www.perplexity.ai/search/x"),
        ],
      },
      launch,
    );

    const reply = await table.call("comet_connect", {});

    expect(launch.launches).toEqual([CONFIGURED_PORT]);
    expect(textOf(reply as never)).toContain("Started Comet");
  });

  it("fails without touching the browser when Comet runs without the port", async () => {
    const launch = new FakeCometLaunch();
    launch.processRunning = true;
    const table = tableOver({}, launch);

    const reply = await table.call("comet_connect", {});

    expect(reply).toMatchObject({ kind: "text", isError: true });
    expect(textOf(reply as never)).toContain(
      "comet --remote-debugging-port=9444",
    );
    expect(launch.launches).toEqual([]);
  });

  it("connects to the main Perplexity tab before the sidecar", async () => {
    const connect = vi.fn().mockResolvedValue("ok");
    const table = tableOver({
      connect,
      listTargets: async () => [
        target("side", "https://www.perplexity.ai/sidecar?x=1"),
        target("main", "https://www.perplexity.ai/"),
      ],
    });

    await table.call("comet_connect", {});

    expect(connect).toHaveBeenCalledWith("main");
  });

  it("navigates a tab that is not on Perplexity, then connects", async () => {
    vi.useFakeTimers();
    const navigate = vi.fn().mockResolvedValue({});
    const table = tableOver({
      connect: async () => "ok",
      navigate,
      listTargets: async () => [target("other", "https://example.com/")],
    });

    const pending = table.call("comet_connect", {});
    await vi.advanceTimersByTimeAsync(1500);
    await pending;

    expect(navigate).toHaveBeenCalledWith("https://www.perplexity.ai/", true);
  });

  it("opens a Perplexity tab when Comet has no page", async () => {
    vi.useFakeTimers();
    const connect = vi.fn().mockResolvedValue("ok");
    const table = tableOver({
      connect,
      newTab: async () => target("fresh", "https://www.perplexity.ai/"),
      listTargets: async () => [],
    });

    const pending = table.call("comet_connect", {});
    await vi.advanceTimersByTimeAsync(2000);
    const reply = await pending;

    expect(connect).toHaveBeenCalledWith("fresh");
    expect(textOf(reply as never)).toBe(
      "Comet is running with the debug port 9444 (Comet/140.0).\nCreated new tab and navigated to Perplexity",
    );
  });
});

describe("comet_tabs", () => {
  it("lists the tabs by default", async () => {
    const table = tableOver({ getTabSummary: async () => "2 tabs" });

    expect(await table.call("comet_tabs", {})).toEqual({
      kind: "text",
      text: "2 tabs",
      isError: false,
    });
  });

  it("names an unknown action", async () => {
    const reply = await tableOver({}).call("comet_tabs", { action: "open" });

    expect(reply).toEqual({
      kind: "text",
      text: "Unknown action: open. Use: list, switch, close",
      isError: true,
    });
  });

  it("switches by tab id after validating it", async () => {
    const connect = vi.fn().mockResolvedValue("ok");

    const reply = await tableOver({ connect }).call("comet_tabs", {
      action: "switch",
      tabId: TAB_ID,
    });

    expect(connect).toHaveBeenCalledWith(TAB_ID);
    expect(textOf(reply as never)).toBe(`Switched to tab: ${TAB_ID}`);
  });

  it("refuses a tab id that is not a UUID, before the client is called", async () => {
    const connect = vi.fn();

    const reply = await tableOver({ connect }).call("comet_tabs", {
      action: "switch",
      tabId: "1; drop",
    });

    expect(connect).not.toHaveBeenCalled();
    expect(reply).toEqual({
      kind: "text",
      text: "Error: Invalid tabId format: 1; drop",
      isError: true,
    });
  });

  it("switches by domain, and says when no tab has it", async () => {
    const connect = vi.fn().mockResolvedValue("ok");
    const found = tabContext({ id: "t1", domain: "github.com" });
    const table = tableOver({
      connect,
      findTabByDomain: async (domain: string) =>
        domain === "github.com" ? found : null,
    });

    const hit = await table.call("comet_tabs", {
      action: "switch",
      domain: "github.com",
    });
    const miss = await table.call("comet_tabs", {
      action: "switch",
      domain: "nowhere.org",
    });

    expect(textOf(hit as never)).toBe(
      "Switched to github.com (https://example.com/)",
    );
    expect(miss).toMatchObject({
      text: "No tab found for the specified domain",
      isError: true,
    });
  });

  it("asks for a domain or a tab id to switch to", async () => {
    const reply = await tableOver({}).call("comet_tabs", { action: "switch" });

    expect(reply).toMatchObject({
      text: "Specify domain or tabId to switch",
      isError: true,
    });
  });

  it("will not close the only browsing tab", async () => {
    const closeTab = vi.fn();
    const table = tableOver({
      getTabContexts: async () => [tabContext({})],
      closeTab,
    });

    const reply = await table.call("comet_tabs", {
      action: "close",
      tabId: TAB_ID,
    });

    expect(closeTab).not.toHaveBeenCalled();
    expect(reply).toMatchObject({
      text: "Cannot close - this is the only browsing tab. Comet needs at least one external tab open.",
      isError: true,
    });
  });

  it("closes a tab by id, and reports a close that failed", async () => {
    const closeTab = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const table = tableOver({
      getTabContexts: async () => [tabContext({}), tabContext({ id: "b" })],
      closeTab,
    });
    const close = { action: "close", tabId: TAB_ID };

    expect(textOf((await table.call("comet_tabs", close)) as never)).toBe(
      `Closed tab: ${TAB_ID}`,
    );
    expect(textOf((await table.call("comet_tabs", close)) as never)).toBe(
      "Failed to close tab",
    );
  });

  it("will not close the main Perplexity tab by domain", async () => {
    const closeTab = vi.fn();
    const table = tableOver({
      getTabContexts: async () => [tabContext({}), tabContext({ id: "b" })],
      findTabByDomain: async () =>
        tabContext({ purpose: "main", domain: "perplexity.ai" }),
      closeTab,
    });

    const reply = await table.call("comet_tabs", {
      action: "close",
      domain: "perplexity.ai",
    });

    expect(closeTab).not.toHaveBeenCalled();
    expect(reply).toMatchObject({
      text: "Cannot close main Perplexity tab",
      isError: true,
    });
  });
});

describe("comet_upload", () => {
  beforeEach(() => {
    // The validator warns, once per call, when no upload root is set.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("needs a filePath", async () => {
    const reply = await tableOver({}).call("comet_upload", {});

    expect(reply).toEqual({
      kind: "text",
      text: "Error: filePath is required",
      isError: true,
    });
  });

  it("refuses a path the validator refuses, before the page is touched", async () => {
    const hasFileInput = vi.fn();

    const reply = await tableOver({ hasFileInput }).call("comet_upload", {
      filePath: "relative/path.png",
      checkOnly: true,
    });

    expect(hasFileInput).not.toHaveBeenCalled();
    expect(reply).toMatchObject({ isError: true });
    expect(textOf(reply as never)).toMatch(/^Error: /);
  });

  it("lists the page's file inputs on checkOnly", async () => {
    const reply = await tableOver({
      hasFileInput: async () => ({
        found: true,
        count: 1,
        selectors: ["input#file"],
      }),
    }).call("comet_upload", {
      filePath: import.meta.filename,
      checkOnly: true,
    });

    expect(textOf(reply as never)).toBe(
      "Found 1 file input(s) on the page:\n  1. input#file\n\nUse comet_upload with filePath to upload to one of these inputs.",
    );
  });

  it("refuses a selector the validator refuses, before the page is touched", async () => {
    const uploadFile = vi.fn();

    const reply = await tableOver({ uploadFile }).call("comet_upload", {
      filePath: import.meta.filename,
      selector: "input<script>",
    });

    expect(uploadFile).not.toHaveBeenCalled();
    expect(reply).toMatchObject({ isError: true });
  });

  it("uploads to the resolved path and reports the client's message", async () => {
    const uploadFile = vi.fn().mockResolvedValue({
      success: true,
      message: "Uploaded",
      inputFound: true,
    });

    const reply = await tableOver({ uploadFile }).call("comet_upload", {
      filePath: import.meta.filename,
      selector: "input#file",
    });

    expect(uploadFile).toHaveBeenCalledWith(
      expect.stringContaining("cdp-tools.test.ts"),
      "input#file",
    );
    expect(reply).toEqual({ kind: "text", text: "Uploaded", isError: false });
  });

  it("lists the available inputs when the upload found none", async () => {
    const reply = await tableOver({
      uploadFile: async () => ({
        success: false,
        message: "No file input found",
        inputFound: false,
      }),
      hasFileInput: async () => ({
        found: true,
        count: 1,
        selectors: ["input#a"],
      }),
    }).call("comet_upload", { filePath: import.meta.filename });

    expect(reply).toMatchObject({ isError: true });
    expect(textOf(reply as never)).toBe(
      "No file input found\n\nAvailable file inputs:\n  1. input#a\n\nTry specifying a selector parameter.",
    );
  });
});
