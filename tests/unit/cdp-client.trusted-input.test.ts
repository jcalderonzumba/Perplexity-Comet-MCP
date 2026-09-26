import { beforeEach, describe, expect, it, vi } from "vitest";
import { CometCDPClient } from "../../src/cdp-client.js";
import { FakeCdpConnection } from "./fakes/fake-cdp-connection.js";

// `CometCDPClient.connect` opens its connection through
// `chrome-remote-interface`; the tests hand it a fake tab instead.
const cdp = vi.hoisted(() => ({
  connection: null as unknown,
}));

vi.mock("chrome-remote-interface", () => ({
  default: Object.assign(async () => cdp.connection, {
    ProtocolError: class extends Error {},
  }),
}));

let tab: FakeCdpConnection;
let client: CometCDPClient;

beforeEach(async () => {
  tab = new FakeCdpConnection();
  cdp.connection = tab;
  client = new CometCDPClient();
  await client.connect("tab-1");
  tab.evaluations.length = 0;
});

const PROMPT_WITH_EVERY_HAZARD =
  // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal ${…} is one of the hazards
  'He said "it\'s" \\ `tick` ${alert(1)}\nline two </script><b>';

/** Every kind of trusted input the client sends, by what it does. */
const trustedInputs: [string, (client: CometCDPClient) => Promise<void>][] = [
  ["insert text", (client) => client.insertText("hello")],
  ["press Enter", (client) => client.pressKey("Enter")],
  ["press Escape", (client) => client.pressKey("Escape")],
  ["click", (client) => client.clickAt({ x: 10, y: 20 })],
];

describe("CometCDPClient.insertText", () => {
  it("inserts the text at the focused element through Input.insertText, unchanged", async () => {
    await client.insertText(PROMPT_WITH_EVERY_HAZARD);

    expect(tab.inputs).toEqual([
      {
        method: "Input.insertText",
        params: { text: PROMPT_WITH_EVERY_HAZARD },
      },
    ]);
  });

  it("puts the text in no page script", async () => {
    await client.insertText(PROMPT_WITH_EVERY_HAZARD);

    expect(tab.evaluations).toEqual([]);
  });
});

describe("CometCDPClient.pressKey", () => {
  it("presses Enter with the codes a real Enter carries, text included", async () => {
    await client.pressKey("Enter");

    expect(tab.inputs).toEqual([
      {
        method: "Input.dispatchKeyEvent",
        params: {
          type: "keyDown",
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
          text: "\r",
          unmodifiedText: "\r",
        },
      },
      {
        method: "Input.dispatchKeyEvent",
        params: {
          type: "keyUp",
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
        },
      },
    ]);
  });

  it("presses Escape with the codes a real Escape carries, and no text", async () => {
    await client.pressKey("Escape");

    expect(tab.inputs).toEqual([
      {
        method: "Input.dispatchKeyEvent",
        params: {
          type: "rawKeyDown",
          key: "Escape",
          code: "Escape",
          windowsVirtualKeyCode: 27,
        },
      },
      {
        method: "Input.dispatchKeyEvent",
        params: {
          type: "keyUp",
          key: "Escape",
          code: "Escape",
          windowsVirtualKeyCode: 27,
        },
      },
    ]);
  });
});

describe("CometCDPClient.clickAt", () => {
  it("clicks with real pointer events while the tab is on Perplexity", async () => {
    await client.clickAt({ x: 10, y: 20 });

    expect(tab.inputs.map((input) => input.method)).toEqual([
      "Input.dispatchMouseEvent",
      "Input.dispatchMouseEvent",
      "Input.dispatchMouseEvent",
    ]);
  });
});

describe("trusted input, only on Perplexity", () => {
  describe.each(trustedInputs)("%s", (action, send) => {
    it.each([
      ["https://example.com", "https://example.com"],
      [
        "https://www.perplexity.ai.example/",
        "https://www.perplexity.ai.example",
      ],
      ["https://perplexity.ai.example/", "https://perplexity.ai.example"],
      ["http://www.perplexity.ai/", "http://www.perplexity.ai"],
      ["https://perplexity.ai/", "https://perplexity.ai"],
      ["https://example.com/www.perplexity.ai/search", "https://example.com"],
      [
        "https://example.com/?next=https://www.perplexity.ai",
        "https://example.com",
      ],
      ["about:blank", "null"],
    ])(
      "is refused, and nothing sent, on a top frame at %s",
      async (url, securityOrigin) => {
        tab.topFrame = { url, securityOrigin };

        await expect(send(client)).rejects.toThrow(
          `refused to ${action}: the tab is on ${securityOrigin}, not https://www.perplexity.ai`,
        );
        expect(tab.inputs).toEqual([]);
      },
    );

    it("is refused on a page that claims Perplexity's origin in its own script", async () => {
      tab.moveTo("https://example.com/");
      tab.pageClaims = "https://www.perplexity.ai";

      await expect(send(client)).rejects.toThrow(`refused to ${action}`);
      expect(tab.inputs).toEqual([]);
      expect(tab.evaluations).toEqual([]);
    });

    it("is refused when the tab's origin cannot be read", async () => {
      tab.frameTreeError = new Error("Target closed");

      await expect(send(client)).rejects.toThrow(
        `refused to ${action}: the tab's origin could not be read (Target closed)`,
      );
      expect(tab.inputs).toEqual([]);
    });

    it("is refused when not connected", async () => {
      await expect(send(new CometCDPClient())).rejects.toThrow(
        "Not connected to Comet. Call connect() first.",
      );
    });
  });

  it("reads the origin afresh before each input, so a tab that moved gets nothing", async () => {
    await client.insertText("first");
    tab.moveTo("https://example.com/");

    await expect(client.pressKey("Enter")).rejects.toThrow(
      "refused to press Enter",
    );
    expect(tab.frameTreeReads).toBe(2);
    expect(tab.inputs).toEqual([
      { method: "Input.insertText", params: { text: "first" } },
    ]);
  });
});
