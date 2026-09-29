import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CometAI } from "../../src/comet-ai.js";
import { FakeCdpClient } from "./fakes/fake-cdp-client.js";

describe("CometAI.agentBrowsingUrl", () => {
  it("is the address of the tab the agent is browsing", async () => {
    const fake = new FakeCdpClient();
    fake.setTabsResult({
      agentBrowsing: {
        id: "tab-1",
        type: "page",
        title: "Whole Foods",
        url: "https://amazon.com/alm/storefront",
      },
    });

    expect(await new CometAI(fake).agentBrowsingUrl()).toBe(
      "https://amazon.com/alm/storefront",
    );
  });

  it("is empty when the agent browses no tab", async () => {
    expect(await new CometAI(new FakeCdpClient()).agentBrowsingUrl()).toBe("");
  });

  it("is empty when the tabs cannot be listed", async () => {
    const fake = new FakeCdpClient();
    fake.listTabsCategorized = async () => {
      throw new Error("not connected");
    };

    expect(await new CometAI(fake).agentBrowsingUrl()).toBe("");
  });

  it("evaluates nothing in the page", async () => {
    const fake = new FakeCdpClient();

    await new CometAI(fake).agentBrowsingUrl();

    expect(fake.evaluateCalls).toEqual([]);
  });
});

// The prompt is typed and submitted with trusted CDP input alone. Input
// made in page script (`execCommand`, a synthetic key event, a form's
// submit event) reports success without the window's focus and types
// nothing, so none of it is left anywhere under `src/`.
describe("src/ sends no input made in page script", () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
  const sources = readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts"))
    .map((file) => [file, readFileSync(join(SRC, file), "utf8")] as const);

  it.each([
    ["execCommand call", /execCommand/],
    ["synthetic KeyboardEvent", /new KeyboardEvent/],
    ["form submit", /form\.submit|new Event\(\s*['"]submit['"]/],
  ])("holds no %s", (_, pattern) => {
    expect(sources.length).toBeGreaterThan(0);
    const offenders = sources.filter(([, text]) => pattern.test(text));
    expect(offenders.map(([file]) => file)).toEqual([]);
  });

  it("gives the Comet module no way to send a prompt of its own", () => {
    const ai = new CometAI(new FakeCdpClient()) as unknown as Record<
      string,
      unknown
    >;
    expect(ai.sendPrompt).toBeUndefined();
    expect(ai.submitPrompt).toBeUndefined();
  });

  it("gives the Comet module no way to stop an answer of its own: the ask core clicks the stop control", () => {
    const ai = new CometAI(new FakeCdpClient()) as unknown as Record<
      string,
      unknown
    >;
    expect(ai.stopAgent).toBeUndefined();
    expect(sources.find(([file]) => file === "comet-ai.ts")?.[1]).not.toMatch(
      /\.evaluate\(/,
    );
  });
});
