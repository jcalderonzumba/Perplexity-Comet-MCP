import { describe, expect, it } from "vitest";

import { declaredTools, schemaViolations } from "./support/declared-tools.js";

const tools = declaredTools();

describe("declaredTools", () => {
  it("reads every tool the stdio server declares", () => {
    expect([...tools.keys()].sort()).toEqual([
      "comet_ask",
      "comet_connect",
      "comet_mode",
      "comet_poll",
      "comet_screenshot",
      "comet_stop",
      "comet_tabs",
      "comet_upload",
    ]);
  });

  it("reads comet_ask's parameters, their types, and the required prompt", () => {
    expect(tools.get("comet_ask")).toEqual({
      properties: {
        prompt: expect.objectContaining({ type: "string" }),
        context: expect.objectContaining({ type: "string" }),
        newChat: expect.objectContaining({ type: "boolean" }),
        timeout: expect.objectContaining({ type: "number" }),
      },
      required: ["prompt"],
    });
  });

  it("reads the allowed values of comet_tabs' action and comet_mode's mode", () => {
    expect(tools.get("comet_tabs")?.properties.action?.enum).toEqual([
      "list",
      "switch",
      "close",
    ]);
    expect(tools.get("comet_mode")?.properties.mode?.enum).toContain(
      "research",
    );
  });
});

describe("schemaViolations", () => {
  it("finds nothing wrong with declared arguments", () => {
    expect(
      schemaViolations(tools, "comet_ask", {
        prompt: "Paris?",
        newChat: true,
        timeout: 60000,
      }),
    ).toEqual([]);
  });

  it("names a parameter the tool does not declare", () => {
    expect(
      schemaViolations(tools, "comet_ask", {
        prompt: "Go to example.com.",
        tabPolicy: "preserve",
      }),
    ).toEqual(["comet_ask declares no parameter tabPolicy"]);
  });

  it("names a missing required parameter", () => {
    expect(schemaViolations(tools, "comet_upload", {})).toEqual([
      "comet_upload needs filePath",
    ]);
  });

  it("names a value of the wrong type, or outside the allowed values", () => {
    expect(
      schemaViolations(tools, "comet_ask", { prompt: "x", newChat: "false" }),
    ).toEqual(["comet_ask's newChat is a boolean, not false"]);
    expect(schemaViolations(tools, "comet_tabs", { action: "open" })).toEqual([
      "comet_tabs's action does not allow open",
    ]);
  });

  it("names a tool the server does not declare", () => {
    expect(schemaViolations(tools, "comet_click", {})).toEqual([
      "comet_click is not a declared tool",
    ]);
  });
});
