// The `comet_screenshot` tool over a one-method port. A capture the port
// cannot take throws, and the tool table words the failure.

import { imageReply, type ToolReply } from "./tool-reply.js";

/** What the tool needs from the browser. */
export interface ScreenshotPort {
  /** Captures the connected page as PNG, base64-encoded. */
  capturePng(): Promise<string>;
}

/** Answers `comet_screenshot`: the page as an image reply. */
export async function answerScreenshot(
  port: ScreenshotPort,
): Promise<ToolReply> {
  return imageReply(await port.capturePng(), "image/png");
}
