import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CometAI } from "../../src/comet-ai.js";
import { FakeCdpClient } from "./fakes/fake-cdp-client.js";

describe("CometAI.getAgentStatus", () => {
  it("returns the parsed shape from a canned safeEvaluate result", async () => {
    const fake = new FakeCdpClient();
    fake.setEvaluateResult({
      status: "completed",
      steps: ["Searching for X", "Reading results"],
      currentStep: "Reading results",
      response: "the agent's final answer",
      hasStopButton: false,
    });

    const ai = new CometAI(fake);
    const status = await ai.getAgentStatus();

    expect(status.status).toBe("completed");
    expect(status.steps).toEqual(["Searching for X", "Reading results"]);
    expect(status.currentStep).toBe("Reading results");
    expect(status.response).toBe("the agent's final answer");
    expect(status.hasStopButton).toBe(false);
    expect(status.agentBrowsingUrl).toBe("");
  });

  it("reports the status the page script reads, however often the same text is read", async () => {
    const fake = new FakeCdpClient();
    fake.setEvaluateResult({
      status: "working",
      steps: [],
      currentStep: "",
      response: "A".repeat(60),
      hasStopButton: false,
    });
    const ai = new CometAI(fake);

    const statuses = [];
    for (let read = 0; read < 4; read++) {
      statuses.push((await ai.getAgentStatus()).status);
    }

    expect(statuses).toEqual(["working", "working", "working", "working"]);
  });

  it("includes the agent-browsing URL when listTabsCategorized returns one", async () => {
    const fake = new FakeCdpClient();
    fake.setTabsResult({
      agentBrowsing: {
        id: "tab-1",
        type: "page",
        title: "Whole Foods",
        url: "https://amazon.com/alm/storefront",
      },
    });
    fake.setEvaluateResult({
      status: "working",
      steps: [],
      currentStep: "",
      response: "",
      hasStopButton: true,
    });

    const ai = new CometAI(fake);
    const status = await ai.getAgentStatus();

    expect(status.agentBrowsingUrl).toBe("https://amazon.com/alm/storefront");
    expect(status.status).toBe("working");
    expect(status.hasStopButton).toBe(true);
  });

  it("ships a stringified IIFE of extractAgentStatus to safeEvaluate", async () => {
    const fake = new FakeCdpClient();
    fake.setEvaluateResult({
      status: "idle",
      steps: [],
      currentStep: "",
      response: "",
      hasStopButton: false,
    });

    const ai = new CometAI(fake);
    await ai.getAgentStatus();

    expect(fake.evaluateCalls.length).toBe(1);
    const js = fake.evaluateCalls[0];
    expect(js).toContain("function extractAgentStatus");
    // Wrapped as an immediately-invoked function expression
    expect(js.endsWith(")()")).toBe(true);
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
