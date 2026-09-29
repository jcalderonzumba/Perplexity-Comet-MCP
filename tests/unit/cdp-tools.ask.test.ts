// @vitest-environment jsdom

// The ask, the poll, the stop and the mode tool as the composition wires
// them, driven through the table over the fake client of the ask port: what
// the configured port, the shared UNTRUSTED wrapper and the cores' wording
// do to a call, not how `cdp-tools.ts` spells the wiring.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CdpToolsClient,
  createCdpToolTable,
} from "../../src/cdp-tools.js";
import type { BrowserTarget } from "../../src/core/perplexity-tab.js";
import { FakeAskClient, FakeAskComet } from "./fakes/fake-ask-client.js";
import { FakeCometLaunch } from "./fakes/fake-comet-launch.js";

const CONFIGURED_PORT = 9444;
const MAIN: BrowserTarget = {
  id: "main",
  type: "page",
  url: "https://www.perplexity.ai/search/a-thread",
};

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

/** The table over the ask port's fake; any other client method fails loudly. */
function rig() {
  const client = new FakeAskClient();
  client.targets = [MAIN];
  const asClient = new Proxy(client, {
    get: (fake, name: string) =>
      name in fake
        ? (fake as unknown as Record<string, unknown>)[name]
        : () => Promise.reject(new Error(`unexpected call: ${name}`)),
  }) as unknown as CdpToolsClient;
  const launch = new FakeCometLaunch();
  const table = createCdpToolTable({
    client: asClient,
    comet: new FakeAskComet(),
    launch,
    quotePage: (text) => `<<${text}>>`,
    port: CONFIGURED_PORT,
  });
  return { client, launch, table };
}

describe("comet_ask", () => {
  it("recovers a lost connection by starting Comet on the configured port", async () => {
    vi.useFakeTimers();
    const { client, launch, table } = rig();
    client.preCheckFails = true;

    const asking = table.call("comet_ask", { prompt: "What is 2 + 2?" });
    await vi.runAllTimersAsync();
    await asking;

    expect(launch.launches).toEqual([CONFIGURED_PORT]);
  });

  it("quotes what the page said with the wrapper the table was given", async () => {
    vi.useFakeTimers();
    const { client, table } = rig();
    client.pageFailure = "page says hi";

    const asking = table.call("comet_ask", { prompt: "What is 2 + 2?" });
    await vi.runAllTimersAsync();
    const reply = await asking;

    expect(reply).toMatchObject({ kind: "text", isError: true });
    expect((reply as { text: string }).text).toContain("<<page says hi>>");
  });
});

describe("comet_poll and comet_stop with no task", () => {
  it("polls to say there is no active task, in the core's words", async () => {
    const reply = await rig().table.call("comet_poll", {});

    expect(reply).toEqual({
      kind: "text",
      text: "Status: IDLE\nNo active task. Use comet_ask to start a new task.",
      isError: false,
    });
  });

  it("stops to say there is no active agent, in the core's words", async () => {
    const reply = await rig().table.call("comet_stop", {});

    expect(reply).toEqual({
      kind: "text",
      text: "No active agent to stop",
      isError: false,
    });
  });
});

describe("comet_mode", () => {
  it("refuses a mode the tool does not offer, in the mode tool's words", async () => {
    const reply = await rig().table.call("comet_mode", { mode: "nonsense" });

    expect(reply).toMatchObject({ kind: "text", isError: true });
  });
});
