// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cdpAskPort, createCdpAskCore } from "../../src/cdp-ask-port.js";
import { createCdpPerplexityTab } from "../../src/cdp-perplexity-tab.js";
import { PageScriptFailed } from "../../src/core/ask.js";
import { sendPrompt } from "../../src/core/ask-send.js";
import { ModeCore } from "../../src/core/mode.js";
import type { BrowserTarget } from "../../src/core/perplexity-tab.js";
import {
  locateStopControl,
  locateSubmitButton,
  pageScriptExpression,
  readAskInput,
  readThreadState,
  selectAskInput,
} from "../../src/page-scripts.js";
import {
  FakeAskClient,
  FakeAskComet,
  WORKING_STATUS,
} from "./fakes/fake-ask-client.js";
import { FakeModePage } from "./fakes/fake-mode-page.js";

const MAIN: BrowserTarget = {
  id: "main",
  type: "page",
  url: "https://www.perplexity.ai/search/a-thread",
};

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

function rig() {
  const client = new FakeAskClient();
  const comet = new FakeAskComet();
  return { client, comet, port: cdpAskPort(client, comet) };
}

describe("cdpAskPort: the connection and the tabs", () => {
  it("checks, starts, connects, reconnects and navigates through the CDP client", async () => {
    const { client, port } = rig();

    await port.preOperationCheck();
    await port.startComet(9555);
    await port.connect("main");
    await port.ensureConnection();
    await port.navigate("https://www.perplexity.ai/", true);

    expect(client.calls).toEqual([
      "preOperationCheck",
      "startComet 9555",
      "connect main",
      "ensureConnection",
      "navigate https://www.perplexity.ai/ wait=true",
    ]);
  });

  it("lists the client's targets", async () => {
    const { client, port } = rig();
    client.targets = [MAIN];

    expect(await port.listTargets()).toEqual([MAIN]);
  });

  it("neither reads nor opens tabs itself: the shared tab choice does that", () => {
    const { port } = rig();

    expect("pageAddress" in port).toBe(false);
    expect("newTab" in port).toBe(false);
  });
});

describe("cdpAskPort: reading the page", () => {
  it("reads the thread's state with its page script", async () => {
    const { client, port } = rig();
    document.body.innerHTML = `<div data-workflow-entry="2">q</div><div class="prose">Paris</div>`;

    expect(await port.readThreadState()).toEqual({
      latestTurn: 2,
      proseCount: 1,
      lastProseText: "Paris",
    });
    expect(client.expressions).toEqual([pageScriptExpression(readThreadState)]);
  });

  it("rejects with the page's error, kept apart from its own words, when a page script fails", async () => {
    const { client, port } = rig();
    client.pageFailure = "TypeError: document is gone";

    const threadFailure = await port.readThreadState().catch((error) => error);

    expect(threadFailure).toBeInstanceOf(PageScriptFailed);
    expect(threadFailure).toMatchObject({
      message: "readThreadState failed in the page",
      pageDetail: "TypeError: document is gone",
    });
  });
});

describe("cdpAskPort: the answer", () => {
  it("reads the status through the Comet module", async () => {
    const { comet, port } = rig();

    expect(await port.readStatus()).toEqual(WORKING_STATUS);

    expect(comet.calls).toEqual(["getAgentStatus"]);
  });
});

const ASK_INPUT_FIXTURE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures", "ask-input.html"),
  "utf8",
);

describe("cdpAskPort: the input bar", () => {
  it("selects the input bar, reads it and finds its Submit button with their page scripts", async () => {
    const { client, port } = rig();
    document.body.innerHTML = ASK_INPUT_FIXTURE;

    expect(await port.selectAskInput()).toBe(true);
    expect((await port.readAskInput())?.trim()).toBe(
      "What is the capital of France?",
    );
    expect(await port.locateSubmitButton()).toEqual({
      x: expect.any(Number),
      y: expect.any(Number),
    });
    expect(client.expressions).toEqual([
      pageScriptExpression(selectAskInput),
      pageScriptExpression(readAskInput),
      pageScriptExpression(locateSubmitButton),
    ]);
  });

  it("inserts text, presses Enter and clicks as the client's trusted input", async () => {
    const { client, port } = rig();

    await port.insertText("Paris?");
    await port.pressEnter();
    await port.clickAt({ x: 3, y: 4 });

    expect(client.calls).toEqual([
      "insertText Paris?",
      "pressKey Enter",
      "clickAt 3,4",
    ]);
  });

  it("starts and stops focus emulation through the client", async () => {
    const { client, port } = rig();

    await port.startFocusEmulation();
    await port.stopFocusEmulation();

    expect(client.calls).toEqual(["startFocusEmulation", "stopFocusEmulation"]);
  });

  it("sends a hostile prompt through trusted text alone: unchanged, and in no page script", async () => {
    const { client, port } = rig();
    document.body.innerHTML = ASK_INPUT_FIXTURE;
    const hostile = `Say "hi" \\ \`cmd\` \${alert(1)} </script><script>alert(2)</script>`;

    await sendPrompt(port, hostile, {
      latestTurn: null,
      proseCount: 0,
      lastProseText: "",
    });

    expect(client.inserted).toEqual([hostile]);
    expect(client.submitted).toEqual([hostile]);
    for (const expression of client.expressions) {
      expect(expression).not.toContain("alert");
    }
  });
});

describe("cdpAskPort: stopping", () => {
  it("finds the input bar's stop control with its page script, and clicks it as trusted input", async () => {
    const { client, comet, port } = rig();
    document.body.innerHTML = ASK_INPUT_FIXTURE;
    const submit = document.querySelector('button[aria-label="Submit"]');
    submit?.setAttribute("aria-label", "Stop response (Esc)");

    const control = await port.locateStopControl();
    expect(control).toEqual({ x: expect.any(Number), y: expect.any(Number) });
    if (control) await port.clickAt(control);

    expect(client.expressions).toEqual([
      pageScriptExpression(locateStopControl),
    ]);
    expect(client.calls).toEqual([`clickAt ${control?.x},${control?.y}`]);
    expect(comet.calls).toEqual([]);
  });

  it("finds no stop control when the input bar shows Submit", async () => {
    const { port } = rig();
    document.body.innerHTML = ASK_INPUT_FIXTURE;

    expect(await port.locateStopControl()).toBeNull();
  });
});

describe("cdpAskPort: time", () => {
  it("tells the time by the system clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_760_000_000_000);

    expect(rig().port.now()).toBe(1_760_000_000_000);
  });

  it("waits the milliseconds it is given", async () => {
    vi.useFakeTimers();
    let waited = false;
    const waiting = rig()
      .port.wait(1500)
      .then(() => {
        waited = true;
      });

    await vi.advanceTimersByTimeAsync(1499);
    expect(waited).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(waited).toBe(true);
  });
});

describe("createCdpAskCore", () => {
  it("recovers a lost connection by starting Comet on the port it is given", async () => {
    vi.useFakeTimers();
    const client = new FakeAskClient();
    const comet = new FakeAskComet();
    client.preCheckFails = true;
    client.targets = [MAIN];
    const core = createCdpAskCore({
      client,
      comet,
      mode: { core: new ModeCore(new FakeModePage()), quotePage: (t) => t },
      perplexity: createCdpPerplexityTab(client),
      cometPort: 9555,
    });

    const asking = core.ask({ prompt: "What is the capital of France?" });
    await vi.runAllTimersAsync();
    const outcome = await asking;

    expect(client.calls.slice(0, 4)).toEqual([
      "preOperationCheck",
      "startComet 9555",
      "listTargets",
      "connect main",
    ]);
    expect(outcome).toMatchObject({
      kind: "failed",
      message:
        "The prompt was not sent: the input bar was not found on the page",
    });
  });
});
