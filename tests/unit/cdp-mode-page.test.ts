// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cdpModePage, createCdpModeTool } from "../../src/cdp-mode-page.js";
import { createCdpPerplexityTab } from "../../src/cdp-perplexity-tab.js";
import {
  type BrowserTarget,
  PerplexityTab,
} from "../../src/core/perplexity-tab.js";
import { pageScriptExpression } from "../../src/page-scripts.js";
import { PERPLEXITY_HOME } from "../../src/perplexity-pages.js";
import { FakePageClient } from "./fakes/fake-page-client.js";
import {
  LOOKALIKE_TAB,
  MAIN_TAB,
  SIDECAR_NAMED_THREAD,
  SIDECAR_TAB,
  USER_TAB,
} from "./fakes/fake-tab-port.js";

afterEach(() => {
  vi.useRealTimers();
});

/** The mode tool over `client`, with a tab choice of its own over it. */
function modeToolOver(
  client: FakePageClient,
  quote: (pageText: string) => string,
): ReturnType<typeof createCdpModeTool> {
  return createCdpModeTool(client, quote, createCdpPerplexityTab(client));
}

function echo(text: string): string {
  return text;
}

function failInPage(): never {
  throw new TypeError("menu vanished");
}

describe("cdpModePage", () => {
  it("runs a page script through evaluate, its arguments serialised", async () => {
    const client = new FakePageClient();
    const label = `"Deep" research</script>\\ ${"`"}`;

    const value = await cdpModePage(client).run(echo, label);

    expect(value).toBe(label);
    expect(client.expressions).toEqual([pageScriptExpression(echo, label)]);
  });

  it("returns what the script returns from the page", async () => {
    document.body.innerHTML = `<p id="mode">Search</p>`;
    const readText = () => document.getElementById("mode")?.textContent;

    expect(await cdpModePage(new FakePageClient()).run(readText)).toBe(
      "Search",
    );
  });

  it("rejects with the page's error when the script throws", async () => {
    const run = cdpModePage(new FakePageClient()).run(failInPage);

    await expect(run).rejects.toThrow(
      "failInPage failed in the page: TypeError: menu vanished",
    );
  });

  it("clicks at the point with the client's pointer click", async () => {
    const client = new FakePageClient();

    await cdpModePage(client).clickAt({ x: 612, y: 388.5 });

    expect(client.clicks).toEqual([{ x: 612, y: 388.5 }]);
  });

  it("passes on a click the client refuses, clicking nothing", async () => {
    const client = new FakePageClient();
    client.inputRefusal = new Error("refused to click: the tab is elsewhere");

    const click = cdpModePage(client).clickAt({ x: 612, y: 388.5 });

    await expect(click).rejects.toThrow("refused to click");
    expect(client.clicks).toEqual([]);
  });

  it("leaves the origin check to the client, reading no address itself", async () => {
    const client = new FakePageClient();

    await cdpModePage(client).clickAt({ x: 1, y: 2 });
    await cdpModePage(client).pressEscape();

    expect(client.calls).toEqual([]);
  });

  it("presses Escape with the client's key press", async () => {
    const client = new FakePageClient();

    await cdpModePage(client).pressEscape();

    expect(client.keys).toEqual(["Escape"]);
  });

  it("passes on an Escape the client refuses", async () => {
    const client = new FakePageClient();
    client.inputRefusal = new Error("refused to press Escape");

    await expect(cdpModePage(client).pressEscape()).rejects.toThrow(
      "refused to press Escape",
    );
    expect(client.keys).toEqual([]);
  });

  it("waits for the time asked", async () => {
    vi.useFakeTimers();
    let done = false;

    const waiting = cdpModePage(new FakePageClient())
      .wait(400)
      .then(() => {
        done = true;
      });
    await vi.advanceTimersByTimeAsync(399);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;

    expect(done).toBe(true);
  });
});

describe("createCdpModeTool: bringing the tab to Perplexity before a switch", () => {
  const quote = (pageText: string) => `<<${pageText}>>`;

  /** The tool's move, with the opened tab's wait run on fake timers. */
  async function openPerplexity(client: FakePageClient): Promise<void> {
    await openPerplexityWith(modeToolOver(client, quote));
  }

  async function openPerplexityWith(
    tool: ReturnType<typeof createCdpModeTool>,
  ): Promise<void> {
    vi.useFakeTimers();
    const moving = tool.openPerplexity();
    await vi.runAllTimersAsync();
    await moving;
  }

  /** A client connected to the first of `targets`, all of them open. */
  function openOn(...targets: BrowserTarget[]): FakePageClient {
    const client = new FakePageClient();
    client.targets = [...targets];
    client.url = targets[0].url;
    return client;
  }

  it("stays on Perplexity's main page, connecting and opening nothing", async () => {
    const client = openOn(MAIN_TAB, SIDECAR_TAB);

    await openPerplexity(client);

    expect(client.connectedTo).toEqual([]);
    expect(client.openedAt).toEqual([]);
  });

  it("does not take the sidecar for Perplexity: it moves to the main tab", async () => {
    const client = openOn(SIDECAR_TAB, MAIN_TAB);

    await openPerplexity(client);

    expect(client.connectedTo).toEqual([MAIN_TAB.id]);
    expect(client.openedAt).toEqual([]);
  });

  it("opens Perplexity's home page in a new tab when only the sidecar and a user's page are open", async () => {
    const client = openOn(SIDECAR_TAB, USER_TAB);

    await openPerplexity(client);

    expect(client.openedAt).toEqual([PERPLEXITY_HOME]);
    expect(client.connectedTo).toEqual(["opened-1"]);
  });

  it.each([
    "https://www.perplexity.ai.example/",
    "https://perplexity.ai.evil.test/search/x",
    "http://www.perplexity.ai/",
    LOOKALIKE_TAB.url,
  ])(
    "does not take %s, which only resembles Perplexity, for it",
    async (url) => {
      const client = openOn({ id: "elsewhere", type: "page", url });

      await openPerplexity(client);

      expect(client.openedAt).toEqual([PERPLEXITY_HOME]);
    },
  );

  it("stays on a thread whose address names a sidecar", async () => {
    const client = openOn(SIDECAR_NAMED_THREAD, SIDECAR_TAB);

    await openPerplexity(client);

    expect(client.connectedTo).toEqual([]);
    expect(client.openedAt).toEqual([]);
  });

  it("moves through the tab choice it is given, whose record then holds the tab it opened", async () => {
    const client = openOn(SIDECAR_TAB, USER_TAB);
    const perplexity = new PerplexityTab(client);

    await openPerplexityWith(createCdpModeTool(client, quote, perplexity));

    expect(perplexity.opened("opened-1")).toBe(true);
  });

  it("reads the tab's address afresh through the client on every switch", async () => {
    const client = openOn(MAIN_TAB, USER_TAB);
    const tool = modeToolOver(client, quote);

    await openPerplexityWith(tool);
    client.url = USER_TAB.url;
    await openPerplexityWith(tool);

    expect(client.calls.filter((call) => call === "pageAddress")).toHaveLength(
      2,
    );
    expect(client.connectedTo).toEqual([MAIN_TAB.id]);
  });
});

describe("createCdpModeTool", () => {
  const quote = (pageText: string) => `<<${pageText}>>`;

  it("reads the page through the client", async () => {
    document.body.innerHTML = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "fixtures",
        "mode-menu.html",
      ),
      "utf8",
    );
    const client = new FakePageClient();

    const reading = await modeToolOver(client, quote).core.readMode();

    expect(reading).toEqual({ kind: "known", mode: "search" });
    expect(client.expressions).not.toEqual([]);
  });

  it("fails a switch without a click when the client refuses the click", async () => {
    document.body.innerHTML = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "fixtures",
        "mode-menu.html",
      ),
      "utf8",
    );
    const client = new FakePageClient();
    client.inputRefusal = new Error(
      "refused to click: the tab is not on https://www.perplexity.ai",
    );

    const result = await modeToolOver(client, quote).core.switchMode(
      "research",
    );

    expect(result).toMatchObject({
      ok: false,
      failure: { kind: "page-error" },
    });
    expect(client.clicks).toEqual([]);
  });

  it("quotes page text with the wrapper it is given", () => {
    expect(modeToolOver(new FakePageClient(), quote).quotePage).toBe(quote);
  });

  it("gives each tool a core of its own", () => {
    const client = new FakePageClient();

    expect(modeToolOver(client, quote).core).not.toBe(
      modeToolOver(client, quote).core,
    );
  });
});
