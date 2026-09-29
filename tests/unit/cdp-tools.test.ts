// The composition: the tool table over the CDP client, the Comet module and
// the UNTRUSTED wrapper. The cores' own rules are pinned in `core/`; this
// pins what the composition itself holds: that connect is bound to the
// configured port and the shared tab choice, and that the upload core's
// port is bound to the client. That the client, the wrapper and the
// configured port reach the other cores is pinned in
// `cdp-tools.ask.test.ts` and `cdp-tools.tab.test.ts`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CdpToolsClient,
  type CdpToolsDeps,
  createCdpToolTable,
} from "../../src/cdp-tools.js";
import { TOOL_DEFINITIONS } from "../../src/core/tools.js";
import { FakeCometLaunch } from "./fakes/fake-comet-launch.js";

const CONFIGURED_PORT = 9444;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function target(id: string, url: string, type = "page") {
  return { id, type, title: id, url };
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
        pageAddress: async () => "https://www.perplexity.ai/search/x",
      },
      launch,
    );

    const reply = await table.call("comet_connect", {});

    expect(launch.probes).toEqual([CONFIGURED_PORT]);
    expect(launch.launches).toEqual([]);
    expect(reply).toEqual({
      kind: "text",
      text: "Comet is running with the debug port 9444 (Comet/140.0).\nConnected to Perplexity's main page: the connection was already on it.",
      isError: false,
    });
  });

  it("launches Comet on the configured port when none runs", async () => {
    const launch = new FakeCometLaunch();
    const table = tableOver(
      { pageAddress: async () => "https://www.perplexity.ai/search/x" },
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

  it("moves the connection to the main page, not the sidecar listed before it", async () => {
    const connect = vi.fn().mockResolvedValue("ok");
    const table = tableOver({
      connect,
      pageAddress: async () => "https://news.example/today",
      listTargets: async () => [
        target("side", "https://www.perplexity.ai/sidecar?x=1"),
        target("main", "https://www.perplexity.ai/"),
      ],
    });

    await table.call("comet_connect", {});

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith("main");
  });

  it("leaves a user's page where it was: it navigates nothing, and opens a tab when no main page is open", async () => {
    vi.useFakeTimers();
    const connect = vi.fn().mockResolvedValue("ok");
    const navigate = vi.fn();
    const table = tableOver({
      connect,
      navigate,
      pageAddress: async () => "https://example.com/",
      newTab: async () => target("fresh", "https://www.perplexity.ai/"),
      listTargets: async () => [target("other", "https://example.com/")],
    });

    const pending = table.call("comet_connect", {});
    await vi.advanceTimersByTimeAsync(2000);
    const reply = await pending;

    expect(navigate).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledWith("fresh");
    expect(textOf(reply as never)).toBe(
      "Comet is running with the debug port 9444 (Comet/140.0).\nConnected to Perplexity's main page: opened it in a new tab.",
    );
  });
});

describe("comet_tabs", () => {
  const USER_ID = "0a1b2c3d-aaaa-4222-8333-444455556666";
  const FRESH_ID = "0a1b2c3d-bbbb-4222-8333-444455556666";

  /** Comet with a user's page open and no Perplexity tab, connected to it. */
  function cometWithOnlyAUsersPage() {
    const targets = [target(USER_ID, "https://example.com/")];
    let connected: string | null = USER_ID;
    const closeTab = vi.fn(async (id: string) => {
      targets.splice(
        targets.findIndex((t) => t.id === id),
        1,
      );
      return true;
    });
    const table = tableOver({
      listTargets: async () => [...targets],
      connect: async (id: string) => {
        connected = id;
      },
      connectedTabId: () => connected,
      pageAddress: async () =>
        targets.find((t) => t.id === connected)?.url ?? "",
      newTab: async (url: string) => {
        const opened = target(FRESH_ID, url);
        targets.push(opened);
        return opened;
      },
      closeTab,
    });
    return { table, closeTab, switchTo: (id: string) => (connected = id) };
  }

  /** The table, after `comet_connect` opened Perplexity in a tab of its own. */
  async function afterConnectOpenedATab() {
    vi.useFakeTimers();
    const comet = cometWithOnlyAUsersPage();
    const connecting = comet.table.call("comet_connect", {});
    await vi.advanceTimersByTimeAsync(2000);
    await connecting;
    return comet;
  }

  it("lists the tabs through the core, wrapped with the composition's wrapper", async () => {
    const { table } = cometWithOnlyAUsersPage();

    const reply = await table.call("comet_tabs", {});

    expect(reply).toEqual({
      kind: "text",
      isError: false,
      text: `1 tab(s) open:\n<<  • AGENT-BROWSING: example.com [ACTIVE]\n    URL: https://example.com/>>`,
    });
  });

  it("lists as opened by the server the tab comet_connect opened, the record connect and comet_tabs share", async () => {
    const { table } = await afterConnectOpenedATab();

    const reply = await table.call("comet_tabs", {});

    expect(textOf(reply as never)).toContain(
      "  • MAIN: www.perplexity.ai [ACTIVE] [OPENED BY SERVER]",
    );
  });

  it("closes the tab comet_connect opened, once the connection is elsewhere", async () => {
    const { table, closeTab, switchTo } = await afterConnectOpenedATab();
    switchTo(USER_ID);

    const reply = await table.call("comet_tabs", {
      action: "close",
      tabId: FRESH_ID,
    });

    expect(closeTab).toHaveBeenCalledWith(FRESH_ID);
    expect(textOf(reply as never)).toMatch(/^Closed tab: /);
  });

  it("refuses a tab the user opened, and closes nothing", async () => {
    const { table, closeTab } = await afterConnectOpenedATab();

    const reply = await table.call("comet_tabs", {
      action: "close",
      tabId: USER_ID,
    });

    expect(closeTab).not.toHaveBeenCalled();
    expect(reply).toMatchObject({ kind: "text", isError: true });
    expect(textOf(reply as never)).toContain("the server did not open it");
  });

  it("switches by tab id through the client", async () => {
    const { table } = cometWithOnlyAUsersPage();

    const reply = await table.call("comet_tabs", {
      action: "switch",
      tabId: USER_ID,
    });

    expect(textOf(reply as never)).toBe(
      `Switched to tab: ${USER_ID}\n<<example.com (https://example.com/)>>`,
    );
  });

  it("refuses an invalid tab id in the core's words, before the client is called", async () => {
    const reply = await tableOver({}).call("comet_tabs", {
      action: "switch",
      tabId: "1; drop",
    });

    expect(reply).toEqual({
      kind: "text",
      text: "Error: Invalid tabId format: 1; drop",
      isError: true,
    });
  });
});

describe("comet_upload", () => {
  beforeEach(() => {
    // The validator warns, once per call, when no upload root is set.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("COMET_UPLOAD_ROOT", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const inputsOnPage = (selectors: Array<string | null>) =>
    vi.fn().mockResolvedValue({ result: { type: "object", value: selectors } });

  it("needs a filePath", async () => {
    const reply = await tableOver({}).call("comet_upload", {});

    expect(reply).toEqual({
      kind: "text",
      text: "Error: filePath is required",
      isError: true,
    });
  });

  it("refuses a path the validator refuses, before the page is touched", async () => {
    const safeEvaluate = vi.fn();
    const attachFile = vi.fn();

    const reply = await tableOver({ safeEvaluate, attachFile }).call(
      "comet_upload",
      { filePath: "relative/path.png", checkOnly: true },
    );

    expect(safeEvaluate).not.toHaveBeenCalled();
    expect(attachFile).not.toHaveBeenCalled();
    expect(reply).toMatchObject({ isError: true });
    expect(textOf(reply as never)).toMatch(/^Error: /);
  });

  it("lists the page's file inputs on checkOnly, wrapped as page content", async () => {
    const reply = await tableOver({
      safeEvaluate: inputsOnPage(["#file"]),
    }).call("comet_upload", {
      filePath: import.meta.filename,
      checkOnly: true,
    });

    expect(textOf(reply as never)).toBe(
      "Found 1 file input(s) on the page:\n<<  1. #file>>\n\nUse comet_upload with filePath to upload to one of these inputs.",
    );
  });

  it("refuses a selector the validator refuses, before the page is touched", async () => {
    const attachFile = vi.fn();

    const reply = await tableOver({ attachFile }).call("comet_upload", {
      filePath: import.meta.filename,
      selector: "input<script>",
    });

    expect(attachFile).not.toHaveBeenCalled();
    expect(reply).toMatchObject({ isError: true });
  });

  it("attaches the resolved path to the input the selector names", async () => {
    const attachFile = vi.fn().mockResolvedValue(true);

    const reply = await tableOver({ attachFile }).call("comet_upload", {
      filePath: import.meta.filename,
      selector: "#file",
    });

    expect(attachFile).toHaveBeenCalledWith(
      expect.stringContaining("cdp-tools.test.ts"),
      "#file",
    );
    expect(textOf(reply as never)).toMatch(/^File uploaded successfully: /);
  });

  it("lists the available inputs when the selector matched nothing", async () => {
    const reply = await tableOver({
      attachFile: async () => false,
      safeEvaluate: inputsOnPage(["#a"]),
    }).call("comet_upload", {
      filePath: import.meta.filename,
      selector: "#missing",
    });

    expect(reply).toMatchObject({ isError: true });
    expect(textOf(reply as never)).toBe(
      "No element found matching selector: #missing\n\nAvailable file inputs:\n<<  1. #a>>\n\nTry specifying a selector parameter.",
    );
  });

  it("words a failure of the connection as an error reply", async () => {
    const reply = await tableOver({
      attachFile: () => Promise.reject(new Error("Not connected to Comet")),
    }).call("comet_upload", {
      filePath: import.meta.filename,
      selector: "#file",
    });

    expect(reply).toEqual({
      kind: "text",
      text: "Error: Not connected to Comet",
      isError: true,
    });
  });
});
