import { describe, expect, it } from "vitest";
import { readTopFrameOrigin } from "../../src/cdp-client.js";

/** A fake of the CDP Page slice `readTopFrameOrigin` uses. */
function pageWithTopFrame(frame: { url: string; securityOrigin: string }) {
  return {
    calls: 0,
    async getFrameTree() {
      this.calls++;
      return { frameTree: { frame } };
    },
  };
}

describe("readTopFrameOrigin", () => {
  it("returns the top frame's security origin, as the browser reports it", async () => {
    const page = pageWithTopFrame({
      url: "https://www.perplexity.ai/search/a-thread",
      securityOrigin: "https://www.perplexity.ai",
    });

    expect(await readTopFrameOrigin(page)).toBe("https://www.perplexity.ai");
    expect(page.calls).toBe(1);
  });

  it("reports the browser's origin, not a host the address merely contains", async () => {
    const page = pageWithTopFrame({
      url: "https://example.com/?q=perplexity.ai",
      securityOrigin: "https://example.com",
    });

    expect(await readTopFrameOrigin(page)).toBe("https://example.com");
  });
});
