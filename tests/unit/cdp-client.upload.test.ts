import { beforeEach, describe, expect, it, vi } from "vitest";
import { CometCDPClient } from "../../src/cdp-client.js";
import {
  validateSelector,
  validateUploadPath,
} from "../../src/upload-validator.js";
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

/** A file the repository commits: a path the validator accepts. */
const FILE = import.meta.filename;

beforeEach(async () => {
  vi.stubEnv("COMET_UPLOAD_ROOT", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  tab = new FakeCdpConnection();
  cdp.connection = tab;
  client = new CometCDPClient();
  await client.connect("tab-1");
  tab.evaluations.length = 0;
});

describe("CometCDPClient.attachFile", () => {
  it("finds the input with the selector as a protocol parameter and sets the file on it", async () => {
    const selector = validateSelector('input[name="a\\"b"]');
    tab.elements.set(selector, 42);
    const path = validateUploadPath(FILE);

    const attached = await client.attachFile(path, selector);

    expect(attached).toBe(true);
    expect(tab.domCalls).toEqual([
      { method: "DOM.querySelector", params: { nodeId: 1, selector } },
      {
        method: "DOM.setFileInputFiles",
        params: { nodeId: 42, files: [path] },
      },
    ]);
  });

  it("sets no file when the selector matches nothing", async () => {
    const attached = await client.attachFile(
      validateUploadPath(FILE),
      validateSelector("#missing"),
    );

    expect(attached).toBe(false);
    expect(tab.domCalls.map((call) => call.method)).toEqual([
      "DOM.querySelector",
    ]);
  });

  it("runs no script in the page: the browser fires the input's events itself", async () => {
    const selector = validateSelector("#resume");
    tab.elements.set(selector, 7);

    await client.attachFile(validateUploadPath(FILE), selector);

    // The reconnecting wrapper's own health check is the one evaluation.
    expect(tab.evaluations.filter((script) => script !== "1+1")).toEqual([]);
  });

  it("refuses a plain string for the path and the selector", () => {
    // Never called: the compiler is the test.
    const attachPlainStrings = () =>
      // @ts-expect-error a plain string is neither a validated path nor a selector
      client.attachFile("/tmp/a.txt", "#resume");

    expect(attachPlainStrings).toBeTypeOf("function");
  });
});
