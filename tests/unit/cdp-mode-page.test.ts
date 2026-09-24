// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cdpModePage,
  createCdpModeTool,
  openPerplexityIfElsewhere,
} from "../../src/cdp-mode-page.js";
import { pageScriptExpression } from "../../src/page-scripts.js";
import { FakePageClient } from "./fakes/fake-page-client.js";

afterEach(() => {
  vi.useRealTimers();
});

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

  it("presses Escape with the client's key press", async () => {
    const client = new FakePageClient();

    await cdpModePage(client).pressEscape();

    expect(client.keys).toEqual(["Escape"]);
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

describe("openPerplexityIfElsewhere", () => {
  it("navigates to Perplexity, waiting for the load, when the tab is elsewhere", async () => {
    const client = new FakePageClient();
    client.currentState = { currentUrl: "https://example.com/" };

    await openPerplexityIfElsewhere(client);

    expect(client.navigations).toEqual([
      "https://www.perplexity.ai/ wait=true",
    ]);
  });

  it("navigates when the tab's address is not known", async () => {
    const client = new FakePageClient();

    await openPerplexityIfElsewhere(client);

    expect(client.navigations).toHaveLength(1);
  });

  it("stays when the tab is on Perplexity already", async () => {
    const client = new FakePageClient();
    client.currentState = {
      currentUrl: "https://www.perplexity.ai/search/some-thread",
    };

    await openPerplexityIfElsewhere(client);

    expect(client.navigations).toEqual([]);
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

    const reading = await createCdpModeTool(client, quote).core.readMode();

    expect(reading).toEqual({ kind: "known", mode: "search" });
    expect(client.expressions).not.toEqual([]);
  });

  it("opens Perplexity through the client", async () => {
    const client = new FakePageClient();
    client.currentState = { currentUrl: "https://example.com/" };

    await createCdpModeTool(client, quote).openPerplexity();

    expect(client.navigations).toEqual([
      "https://www.perplexity.ai/ wait=true",
    ]);
  });

  it("quotes page text with the wrapper it is given", () => {
    expect(createCdpModeTool(new FakePageClient(), quote).quotePage).toBe(
      quote,
    );
  });

  it("gives each tool a core of its own", () => {
    const client = new FakePageClient();

    expect(createCdpModeTool(client, quote).core).not.toBe(
      createCdpModeTool(client, quote).core,
    );
  });
});
