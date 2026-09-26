// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cdpAskPort, createCdpAskCore } from "../../src/cdp-ask-port.js";
import { type AskTarget, PageScriptFailed } from "../../src/core/ask.js";
import { sendPrompt } from "../../src/core/ask-send.js";
import { ModeCore } from "../../src/core/mode.js";
import {
  locateSubmitButton,
  pageScriptExpression,
  readAskInput,
  readPageAddress,
  readProseState,
  selectAskInput,
} from "../../src/page-scripts.js";
import {
  FakeAskClient,
  FakeAskComet,
  WORKING_STATUS,
} from "./fakes/fake-ask-client.js";
import { FakeModePage } from "./fakes/fake-mode-page.js";

const MAIN: AskTarget = {
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

  it("finds the main tab among the client's categorised tabs", async () => {
    const { client, port } = rig();

    expect(await port.mainTab()).toBeNull();
    client.mainTab = MAIN;
    expect(await port.mainTab()).toEqual(MAIN);
  });

  it("asks the client whether the tab is on Perplexity, and to move it there", async () => {
    const { client, port } = rig();
    client.onPerplexity = false;

    expect(await port.isOnPerplexityTab()).toBe(false);
    expect(await port.ensureOnPerplexityTab()).toBe(false);
    expect(client.calls).toEqual([
      "isOnPerplexityTab",
      "ensureOnPerplexityTab",
    ]);
  });
});

describe("cdpAskPort: reading the page", () => {
  it("reads the prose state with its page script", async () => {
    const { client, port } = rig();
    document.body.innerHTML = `<div class="prose">first</div><div class="prose">Paris</div>`;

    expect(await port.readProseState()).toEqual({
      count: 2,
      lastText: "Paris",
    });
    expect(client.expressions).toEqual([pageScriptExpression(readProseState)]);
  });

  it("reads the tab's address with its page script", async () => {
    const { client, port } = rig();
    window.history.pushState({}, "", "/search/a-thread");

    expect(await port.currentUrl()).toBe(
      `${window.location.origin}/search/a-thread`,
    );
    expect(client.expressions).toEqual([pageScriptExpression(readPageAddress)]);
  });

  it("rejects with the page's error, kept apart from its own words, when a page script fails", async () => {
    const { client, port } = rig();
    client.pageFailure = "TypeError: document is gone";

    const proseFailure = await port.readProseState().catch((error) => error);
    const addressFailure = await port.currentUrl().catch((error) => error);

    expect(proseFailure).toBeInstanceOf(PageScriptFailed);
    expect(proseFailure).toMatchObject({
      message: "readProseState failed in the page",
      pageDetail: "TypeError: document is gone",
    });
    expect(addressFailure).toBeInstanceOf(PageScriptFailed);
    expect(addressFailure).toMatchObject({
      message: "readPageAddress failed in the page",
      pageDetail: "TypeError: document is gone",
    });
  });
});

describe("cdpAskPort: the answer", () => {
  it("reads the status and resets the stability tracking through the Comet module", async () => {
    const { comet, port } = rig();

    expect(await port.readStatus()).toEqual(WORKING_STATUS);
    port.resetStabilityTracking();

    expect(comet.calls).toEqual(["getAgentStatus", "resetStabilityTracking"]);
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

  it("sends a hostile prompt through trusted text alone: unchanged, and in no page script", async () => {
    const { client, port } = rig();
    document.body.innerHTML = ASK_INPUT_FIXTURE;
    const hostile = `Say "hi" \\ \`cmd\` \${alert(1)} </script><script>alert(2)</script>`;

    await sendPrompt(port, hostile, { count: 0, lastText: "" });

    expect(client.inserted).toEqual([hostile]);
    expect(client.submitted).toEqual([hostile]);
    for (const expression of client.expressions) {
      expect(expression).not.toContain("alert");
    }
  });
});

describe("cdpAskPort: stopping", () => {
  it("stops the answer through the Comet module, and says whether it did", async () => {
    const { comet, port } = rig();

    expect(await port.stopAgent()).toBe(true);
    comet.hasStopControl = false;
    expect(await port.stopAgent()).toBe(false);

    expect(comet.calls).toEqual(["stopAgent", "stopAgent"]);
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
