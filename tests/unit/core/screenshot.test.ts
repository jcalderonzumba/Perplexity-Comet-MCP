import { describe, expect, it } from "vitest";
import {
  answerScreenshot,
  type ScreenshotPort,
} from "../../../src/core/screenshot.js";

class FakeScreenshotPort implements ScreenshotPort {
  captures = 0;
  failure: Error | undefined;

  async capturePng(): Promise<string> {
    this.captures += 1;
    if (this.failure) throw this.failure;
    return "iVBORw0KGgo=";
  }
}

describe("answerScreenshot", () => {
  it("returns the port's capture as a PNG image reply", async () => {
    const port = new FakeScreenshotPort();

    const reply = await answerScreenshot(port);

    expect(reply).toEqual({
      kind: "image",
      data: "iVBORw0KGgo=",
      mimeType: "image/png",
    });
    expect(port.captures).toBe(1);
  });

  it("lets a failed capture reach the tool table as it is", async () => {
    const port = new FakeScreenshotPort();
    port.failure = new Error("Not connected to Comet");

    await expect(answerScreenshot(port)).rejects.toThrow(
      "Not connected to Comet",
    );
  });
});
