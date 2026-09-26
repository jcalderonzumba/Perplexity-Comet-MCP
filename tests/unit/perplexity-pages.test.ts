import { describe, expect, it } from "vitest";
import {
  isPerplexityMainPage,
  PERPLEXITY_HOME,
  PERPLEXITY_ORIGIN,
} from "../../src/perplexity-pages.js";

describe("isPerplexityMainPage", () => {
  it.each([
    "https://www.perplexity.ai/",
    "https://www.perplexity.ai",
    "https://www.perplexity.ai/search/a-thread-abc123",
    "https://www.perplexity.ai/?q=sidecar",
    "https://WWW.Perplexity.AI/search/upper-case-host",
    "https://www.perplexity.ai:443/search/default-port",
  ])("takes %s for Perplexity's main page", (address) => {
    expect(isPerplexityMainPage(address)).toBe(true);
  });

  it("takes a thread whose address names the sidecar for a main page, as a substring check would not", () => {
    expect(
      isPerplexityMainPage(
        "https://www.perplexity.ai/search/what-is-a-motorcycle-sidecar-x1",
      ),
    ).toBe(true);
  });

  it.each([
    "https://www.perplexity.ai/sidecar",
    "https://www.perplexity.ai/sidecar?copilot=true",
    "https://www.perplexity.ai/sidecar/",
    "https://www.perplexity.ai/sidecar/thread",
  ])("does not take the sidecar, %s, for the main page", (address) => {
    expect(isPerplexityMainPage(address)).toBe(false);
  });

  it.each([
    "https://www.perplexity.ai.example/",
    "https://perplexity.ai.evil.test/search/x",
    "http://www.perplexity.ai/",
    "https://perplexity.ai/",
    "https://www.perplexity.ai:8443/",
    "https://news.example/perplexity.ai/story",
    "https://news.example/?next=https://www.perplexity.ai/",
    "https://news.example/#https://www.perplexity.ai/",
  ])(
    "does not take %s, which only names Perplexity, for its main page",
    (address) => {
      expect(isPerplexityMainPage(address)).toBe(false);
    },
  );

  it.each(["", "about:blank", "chrome://newtab/", "not an address"])(
    "does not take %j for Perplexity's main page",
    (address) => {
      expect(isPerplexityMainPage(address)).toBe(false);
    },
  );
});

describe("Perplexity's addresses", () => {
  it("has one origin, whose home page is its root", () => {
    expect(PERPLEXITY_ORIGIN).toBe("https://www.perplexity.ai");
    expect(PERPLEXITY_HOME).toBe("https://www.perplexity.ai/");
    expect(isPerplexityMainPage(PERPLEXITY_HOME)).toBe(true);
  });
});
