import { describe, expect, it } from "vitest";
import {
  isToolMode,
  MODE_CATALOGUE,
  TOOL_MODES,
  toolModeForPageLabel,
} from "../../src/modes.js";

describe("TOOL_MODES", () => {
  it("lists the tool modes in the order the tool contract publishes them", () => {
    expect(TOOL_MODES).toEqual(["search", "research", "labs", "learn"]);
  });
});

describe("MODE_CATALOGUE", () => {
  it("has an entry for every tool mode and no other", () => {
    expect(Object.keys(MODE_CATALOGUE).sort()).toEqual([...TOOL_MODES].sort());
  });

  it("selects the page's Search item for search", () => {
    expect(MODE_CATALOGUE.search).toEqual({
      selectable: true,
      pageLabel: "Search",
    });
  });

  it("selects the page's Deep research item for research", () => {
    expect(MODE_CATALOGUE.research).toEqual({
      selectable: true,
      pageLabel: "Deep research",
    });
  });

  it("says labs is not offered by Perplexity's current input bar", () => {
    expect(MODE_CATALOGUE.labs).toEqual({
      selectable: false,
      reason: "not offered by Perplexity's current input bar",
    });
  });

  it("says learn is not supported yet", () => {
    expect(MODE_CATALOGUE.learn).toEqual({
      selectable: false,
      reason: "not supported yet",
    });
  });
});

describe("isToolMode", () => {
  it.each(TOOL_MODES)("accepts %s", (mode) => {
    expect(isToolMode(mode)).toBe(true);
  });

  it.each([
    "invalid_mode_xyz",
    "Search",
    "research ",
    "",
    "'; alert(1); '",
    "toString",
    undefined,
    null,
    42,
  ])("refuses %j", (value) => {
    expect(isToolMode(value)).toBe(false);
  });
});

describe("toolModeForPageLabel", () => {
  it("maps each selectable mode's page label back to the mode", () => {
    expect(toolModeForPageLabel("Search")).toBe("search");
    expect(toolModeForPageLabel("Deep research")).toBe("research");
  });

  it("returns undefined for a label the catalogue does not know", () => {
    expect(toolModeForPageLabel("Learn step by step")).toBeUndefined();
    expect(toolModeForPageLabel("Research")).toBeUndefined();
    expect(toolModeForPageLabel("")).toBeUndefined();
  });

  it("does not map a mode's own name, only its page label", () => {
    expect(toolModeForPageLabel("research")).toBeUndefined();
    expect(toolModeForPageLabel("labs")).toBeUndefined();
  });
});
