import { describe, expect, it } from "vitest";
import {
  ASK_DEFAULT_TIMEOUT_MS,
  type AskRequest,
  readAskRequest,
  shapePrompt,
  withContext,
} from "../../../src/core/ask-input.js";

function requestOf(args: Record<string, unknown> | undefined): AskRequest {
  const read = readAskRequest(args);
  if (!read.ok) throw new Error(`expected a request, got: ${read.reason}`);
  return read.request;
}

function refusalOf(args: Record<string, unknown> | undefined): string {
  const read = readAskRequest(args);
  if (read.ok) throw new Error("expected a refusal, got a request");
  return read.reason;
}

describe("readAskRequest: the prompt", () => {
  it("refuses an absent prompt as empty", () => {
    expect(refusalOf({})).toBe("prompt cannot be empty");
    expect(refusalOf(undefined)).toBe("prompt cannot be empty");
  });

  it("refuses an empty or blank prompt", () => {
    expect(refusalOf({ prompt: "" })).toBe("prompt cannot be empty");
    expect(refusalOf({ prompt: "  \n\t " })).toBe("prompt cannot be empty");
  });

  it("refuses a prompt that is not text, naming the parameter", () => {
    expect(refusalOf({ prompt: 42 })).toMatch(/^prompt must be a string/);
  });

  it("keeps the prompt as given", () => {
    expect(requestOf({ prompt: " What is 2+2? " }).prompt).toBe(
      " What is 2+2? ",
    );
  });
});

describe("readAskRequest: the timeout", () => {
  it("means the default when absent", () => {
    expect(requestOf({ prompt: "q" }).timeoutMs).toBe(ASK_DEFAULT_TIMEOUT_MS);
    expect(requestOf({ prompt: "q", timeout: null }).timeoutMs).toBe(
      ASK_DEFAULT_TIMEOUT_MS,
    );
  });

  it("means the default when zero, as a number or as a numeric string", () => {
    expect(requestOf({ prompt: "q", timeout: 0 }).timeoutMs).toBe(
      ASK_DEFAULT_TIMEOUT_MS,
    );
    expect(requestOf({ prompt: "q", timeout: "0" }).timeoutMs).toBe(
      ASK_DEFAULT_TIMEOUT_MS,
    );
  });

  it("keeps a positive number", () => {
    expect(requestOf({ prompt: "q", timeout: 3000 }).timeoutMs).toBe(3000);
  });

  it("reads a numeric string as its number", () => {
    expect(requestOf({ prompt: "q", timeout: "45000" }).timeoutMs).toBe(45000);
    expect(requestOf({ prompt: "q", timeout: " 2500 " }).timeoutMs).toBe(2500);
  });

  it.each([
    ["text", "soon"],
    ["an empty string", ""],
    ["a negative number", -1],
    ["a negative numeric string", "-5000"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a boolean", true],
    ["an object", { ms: 3000 }],
  ])("refuses %s, naming the parameter", (_, timeout) => {
    expect(refusalOf({ prompt: "q", timeout })).toMatch(/^timeout must be /);
  });
});

describe("readAskRequest: newChat", () => {
  it("is false when absent", () => {
    expect(requestOf({ prompt: "q" }).newChat).toBe(false);
    expect(requestOf({ prompt: "q", newChat: null }).newChat).toBe(false);
  });

  it("keeps a boolean", () => {
    expect(requestOf({ prompt: "q", newChat: true }).newChat).toBe(true);
    expect(requestOf({ prompt: "q", newChat: false }).newChat).toBe(false);
  });

  it.each([
    ["the string false", "false"],
    ["the string true", "true"],
    ["a number", 1],
  ])("refuses %s, naming the parameter", (_, newChat) => {
    expect(refusalOf({ prompt: "q", newChat })).toMatch(
      /^newChat must be a boolean/,
    );
  });
});

describe("readAskRequest: the context", () => {
  it("is absent when not given", () => {
    expect(requestOf({ prompt: "q" }).context).toBeUndefined();
    expect(requestOf({ prompt: "q", context: null }).context).toBeUndefined();
  });

  it("keeps a string", () => {
    expect(requestOf({ prompt: "q", context: "notes" }).context).toBe("notes");
  });

  it("refuses a context that is not text, naming the parameter", () => {
    expect(refusalOf({ prompt: "q", context: ["notes"] })).toMatch(
      /^context must be a string/,
    );
  });
});

describe("withContext", () => {
  it("leaves the prompt alone without a context, or with a blank one", () => {
    expect(withContext("What is it?", undefined)).toBe("What is it?");
    expect(withContext("What is it?", "  \n ")).toBe("What is it?");
  });

  it("prefixes the trimmed context in a fenced block", () => {
    expect(withContext("what is the project name?", "\n name: comet \n")).toBe(
      "Context for this task:\n```\nname: comet\n```\n\nBased on the above context, what is the project name?",
    );
  });
});

describe("shapePrompt: normalisation", () => {
  it("drops bullets and collapses newlines and runs of spaces", () => {
    expect(
      shapePrompt("Compare:\n- apples\n* pears\n•  plums\n\n  please"),
    ).toBe("Compare: apples pears plums please");
  });

  it("trims the prompt", () => {
    expect(shapePrompt("   What is 2+2?   ")).toBe("What is 2+2?");
  });
});

describe("shapePrompt: the agentic rewrite", () => {
  it("asks the browser to navigate to a URL the prompt names", () => {
    // The URL's two neighbouring spaces stay, as they always have.
    expect(shapePrompt("summarise https://example.com/post for me")).toBe(
      "Use your browser to navigate to https://example.com/post and summarise  for me",
    );
  });

  it("asks the browser to look at a bare URL", () => {
    expect(shapePrompt("https://example.com")).toBe(
      "Use your browser to navigate to https://example.com and tell me what you find there",
    );
  });

  it("asks the browser to go to a site the prompt names", () => {
    expect(shapePrompt("What does the example.com homepage say?")).toBe(
      "Use your browser to go and What does the example.com homepage say?",
    );
  });

  it("does not add 'go and' before a prompt that starts with go", () => {
    expect(shapePrompt("Go to the GitHub trending page")).toBe(
      "Use your browser to Go to the GitHub trending page",
    );
  });

  it("leaves a prompt that already asks for the browser alone", () => {
    expect(
      shapePrompt("Use your browser to open example.com and read the title"),
    ).toBe("Use your browser to open example.com and read the title");
    expect(shapePrompt("Navigate to https://example.com")).toBe(
      "Navigate to https://example.com",
    );
  });

  it("leaves a prompt that names no site or URL alone", () => {
    expect(shapePrompt("What is the capital of France?")).toBe(
      "What is the capital of France?",
    );
  });
});
