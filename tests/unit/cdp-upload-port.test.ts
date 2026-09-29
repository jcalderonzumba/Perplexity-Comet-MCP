import { describe, expect, it, vi } from "vitest";
import { createCdpUploadPort } from "../../src/cdp-upload-port.js";
import { PageScriptFailed } from "../../src/core/page-script-failed.js";
import {
  listFileInputs,
  pageScriptExpression,
} from "../../src/page-scripts.js";
import type { EvaluateResult } from "../../src/types.js";
import {
  validateSelector,
  validateUploadPath,
} from "../../src/upload-validator.js";

function clientAnswering(value: unknown) {
  return {
    safeEvaluate: vi.fn(
      async (): Promise<EvaluateResult> => ({
        result: { type: "object", value },
      }),
    ),
    attachFile: vi.fn(async () => true),
  };
}

describe("the CDP upload port", () => {
  it("lists the inputs by running the page script, through the reconnecting evaluate", async () => {
    const client = clientAnswering(["#resume", null]);

    const inputs = await createCdpUploadPort(client).listFileInputs();

    expect(client.safeEvaluate).toHaveBeenCalledWith(
      pageScriptExpression(listFileInputs),
    );
    expect(inputs).toEqual(["#resume", null]);
  });

  it("reads an entry the page gave that is not a string as no selector", async () => {
    const client = clientAnswering(["#resume", 7, { toString: "x" }, null]);

    expect(await createCdpUploadPort(client).listFileInputs()).toEqual([
      "#resume",
      null,
      null,
      null,
    ]);
  });

  it("fails when the page gives back something that is not a list", async () => {
    const client = clientAnswering("not a list");

    await expect(createCdpUploadPort(client).listFileInputs()).rejects.toThrow(
      /did not return a list/,
    );
  });

  it("reports a page script that threw, keeping the page's words apart", async () => {
    const client = clientAnswering(undefined);
    client.safeEvaluate.mockResolvedValue({
      result: { type: "object" },
      exceptionDetails: {
        text: "Uncaught",
        exception: { description: "TypeError: x is not a function" },
      },
    });

    const failure = await createCdpUploadPort(client)
      .listFileInputs()
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PageScriptFailed);
    expect(failure).toMatchObject({
      scriptName: "listFileInputs",
      pageDetail: "TypeError: x is not a function",
    });
  });

  it("attaches through the client", async () => {
    const client = clientAnswering(undefined);
    client.attachFile.mockResolvedValue(false);
    const path = validateUploadPath(import.meta.filename);
    const selector = validateSelector("#resume");

    const attached = await createCdpUploadPort(client).attachFile(
      path,
      selector,
    );

    expect(attached).toBe(false);
    expect(client.attachFile).toHaveBeenCalledWith(path, selector);
  });
});
