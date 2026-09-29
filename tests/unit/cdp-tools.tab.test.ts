// The mode tool and the ask core share one record of the tabs the server
// opened (principle 6: never close a tab the server did not open), and
// nothing the table answers today shows which record a tab went into. So the
// builders are wrapped to pass through to the real ones while recording what
// they were given and what they returned.

import { describe, expect, it, vi } from "vitest";

const built = vi.hoisted(() => ({
  tabs: [] as unknown[],
  modeTabs: [] as unknown[],
  askTabs: [] as unknown[],
  modeTools: [] as unknown[],
  askModes: [] as unknown[],
}));

vi.mock("../../src/cdp-perplexity-tab.js", async (importActual) => {
  const actual =
    await importActual<typeof import("../../src/cdp-perplexity-tab.js")>();
  return {
    ...actual,
    createCdpPerplexityTab: (
      ...args: Parameters<typeof actual.createCdpPerplexityTab>
    ) => {
      const tab = actual.createCdpPerplexityTab(...args);
      built.tabs.push(tab);
      return tab;
    },
  };
});

vi.mock("../../src/cdp-mode-page.js", async (importActual) => {
  const actual =
    await importActual<typeof import("../../src/cdp-mode-page.js")>();
  return {
    ...actual,
    createCdpModeTool: (
      ...args: Parameters<typeof actual.createCdpModeTool>
    ) => {
      built.modeTabs.push(args[2]);
      const tool = actual.createCdpModeTool(...args);
      built.modeTools.push(tool);
      return tool;
    },
  };
});

vi.mock("../../src/cdp-ask-port.js", async (importActual) => {
  const actual =
    await importActual<typeof import("../../src/cdp-ask-port.js")>();
  return {
    ...actual,
    createCdpAskCore: (...args: Parameters<typeof actual.createCdpAskCore>) => {
      built.askTabs.push(args[0].perplexity);
      built.askModes.push(args[0].mode);
      return actual.createCdpAskCore(...args);
    },
  };
});

import { createCdpToolTable } from "../../src/cdp-tools.js";
import { FakeCometLaunch } from "./fakes/fake-comet-launch.js";

describe("createCdpToolTable's tab record", () => {
  it("gives the mode tool and the ask core the one tab choice it built, and the ask that mode tool", () => {
    createCdpToolTable({
      client: {} as never,
      comet: { getAgentStatus: vi.fn() },
      launch: new FakeCometLaunch(),
      quotePage: (text) => text,
      port: 9444,
    });

    expect(built.tabs).toHaveLength(1);
    expect(built.modeTabs).toHaveLength(1);
    expect(built.askTabs).toHaveLength(1);
    expect(built.modeTabs[0]).toBe(built.tabs[0]);
    expect(built.askTabs[0]).toBe(built.tabs[0]);
    expect(built.askModes[0]).toBe(built.modeTools[0]);
  });

  it("puts the tab comet_connect opens in the record the ask and the mode share", async () => {
    vi.useFakeTimers();
    const launch = new FakeCometLaunch();
    launch.answering = "Comet/140.0";
    const table = createCdpToolTable({
      client: {
        pageAddress: async () => "https://news.example/today",
        listTargets: async () => [],
        connect: async () => "ok",
        newTab: async () => ({
          id: "fresh",
          type: "page",
          title: "",
          url: "https://www.perplexity.ai/",
        }),
      } as never,
      comet: { getAgentStatus: vi.fn() },
      launch,
      quotePage: (text) => text,
      port: 9444,
    });

    const pending = table.call("comet_connect", {});
    await vi.advanceTimersByTimeAsync(2000);
    await pending;

    const shared = built.tabs[built.tabs.length - 1] as {
      opened(id: string): boolean;
    };
    expect(shared.opened("fresh")).toBe(true);
    expect(built.modeTabs[built.modeTabs.length - 1]).toBe(shared);
    vi.useRealTimers();
  });
});
