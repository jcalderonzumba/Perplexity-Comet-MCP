import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  describeModeFailure,
  MODE_TIMING,
  ModeCore,
  type ModeFailure,
} from "../../../src/core/mode.js";
import { FakeModePage } from "../fakes/fake-mode-page.js";

// The longest any one call may wait, in the fake's virtual milliseconds:
// every bounded wait of a switch, with room to spare.
const WAIT_BOUND_MS =
  MODE_TIMING.pageReadyMs +
  4 * (MODE_TIMING.settleMs + MODE_TIMING.menuOpenMs) +
  MODE_TIMING.readBackMs +
  MODE_TIMING.menuCloseMs;

const quote = (pageText: string) => `<<${pageText}>>`;

function failureOf(result: { ok: boolean }): ModeFailure {
  if (result.ok) throw new Error("expected a failure, got success");
  return (result as { ok: false; failure: ModeFailure }).failure;
}

describe("ModeCore.switchMode", () => {
  it("switches to research through the menu and remembers it", async () => {
    const page = new FakeModePage();
    const core = new ModeCore(page);

    const result = await core.switchMode("research");

    expect(result).toEqual({ ok: true, mode: "research" });
    expect(page.checked).toBe("Deep research");
    expect(core.rememberedMode).toBe("research");
    expect(page.isMenuOpen).toBe(false);
  });

  it("selects the item by the catalogue's label, passed as an argument", async () => {
    const page = new FakeModePage();

    await new ModeCore(page).switchMode("research");

    const itemLookups = page.scriptArguments.filter(
      (_, index) => page.scriptsRun[index] === "locateModeMenuItem",
    );
    expect(itemLookups).toEqual([["Deep research"]]);
  });

  it("reads the checked item back by reopening the menu, waiting for the page to settle so no click is wasted", async () => {
    const page = new FakeModePage();

    await new ModeCore(page).switchMode("research");

    expect(page.clicks).toEqual(["button", "item:Deep research", "button"]);
    expect(page.escapes).toBe(1);
  });

  it("fails when the page shows no mode button, within the bounded wait and without a click", async () => {
    const page = new FakeModePage({ hasButton: false });
    const core = new ModeCore(page);

    const failure = failureOf(await core.switchMode("research"));

    expect(failure).toEqual({ kind: "no-button", mode: "research" });
    expect(page.clicks).toEqual([]);
    expect(page.waitedMs).toBeGreaterThanOrEqual(MODE_TIMING.pageReadyMs);
    expect(page.waitedMs).toBeLessThanOrEqual(WAIT_BOUND_MS);
    expect(core.rememberedMode).toBeUndefined();
  });

  it("waits for a button that appears while the page loads", async () => {
    const page = new FakeModePage({ buttonAppearsAfterMs: 2_000 });

    const result = await new ModeCore(page).switchMode("research");

    expect(result).toEqual({ ok: true, mode: "research" });
    expect(page.checked).toBe("Deep research");
  });

  it("fails naming the labels present when the menu has no such item, and closes the menu", async () => {
    const page = new FakeModePage({ labels: ["Search", "Learn step by step"] });
    const core = new ModeCore(page);

    const failure = failureOf(await core.switchMode("research"));

    expect(failure).toEqual({
      kind: "item-missing",
      mode: "research",
      label: "Deep research",
      labelsPresent: ["Search", "Learn step by step"],
    });
    expect(page.isMenuOpen).toBe(false);
    expect(page.escapes).toBe(1);
    expect(core.rememberedMode).toBeUndefined();
  });

  it("fails naming the checked label when the selection does not take, and keeps the remembered mode", async () => {
    const page = new FakeModePage();
    const core = new ModeCore(page);
    await core.switchMode("search");
    page.selectionTakes = false;

    const failure = failureOf(await core.switchMode("research"));

    expect(failure).toEqual({
      kind: "read-back-mismatch",
      mode: "research",
      label: "Deep research",
      checkedLabel: "Search",
      buttonText: "Search",
    });
    expect(core.rememberedMode).toBe("search");
    expect(page.isMenuOpen).toBe(false);
  });

  it("fails when the item is checked but the button does not name it", async () => {
    const page = new FakeModePage();
    page.buttonFollowsSelection = false;
    const core = new ModeCore(page);

    const failure = failureOf(await core.switchMode("research"));

    expect(failure).toMatchObject({
      kind: "read-back-mismatch",
      checkedLabel: "Deep research",
      buttonText: "Search",
    });
    expect(core.rememberedMode).toBeUndefined();
    expect(page.isMenuOpen).toBe(false);
  });

  it.each([
    ["labs", "not offered by Perplexity's current input bar"],
    ["learn", "not supported yet"],
  ])(
    "refuses %s with the catalogue's reason before any page call",
    async (mode, reason) => {
      const page = new FakeModePage();
      const core = new ModeCore(page);

      const failure = failureOf(await core.switchMode(mode));

      expect(failure).toEqual({ kind: "not-selectable", mode, reason });
      expect(page.scriptsRun).toEqual([]);
      expect(page.clicks).toEqual([]);
      expect(core.rememberedMode).toBeUndefined();
    },
  );

  it.each([
    "invalid_mode_xyz",
    'research"); alert(1); ("',
    "</script><script>alert(1)</script>",
    "Research",
    "",
  ])("refuses the unknown mode %j before any page call", async (mode) => {
    const page = new FakeModePage();

    const failure = failureOf(await new ModeCore(page).switchMode(mode));

    expect(failure).toEqual({ kind: "invalid-mode", input: mode });
    expect(page.scriptsRun).toEqual([]);
  });

  it("refuses a mode that is not a string before any page call", async () => {
    const page = new FakeModePage();

    const failure = failureOf(await new ModeCore(page).switchMode(42));

    expect(failure).toEqual({ kind: "invalid-mode", input: "42" });
    expect(page.scriptsRun).toEqual([]);
  });

  it("fails naming the button's text when the menu never opens, after one retry and within the bounded wait", async () => {
    const page = new FakeModePage();
    page.ignoredButtonClicks = Number.POSITIVE_INFINITY;
    const core = new ModeCore(page);

    const failure = failureOf(await core.switchMode("research"));

    expect(failure).toEqual({
      kind: "menu-did-not-open",
      mode: "research",
      buttonText: "Search",
    });
    expect(page.clicks).toEqual(["button", "button"]);
    expect(page.waitedMs).toBeLessThanOrEqual(WAIT_BOUND_MS);
    expect(page.isMenuOpen).toBe(false);
    expect(core.rememberedMode).toBeUndefined();
  });

  it("retries once when the first click does not open the menu", async () => {
    const page = new FakeModePage();
    page.ignoredButtonClicks = 1;

    const result = await new ModeCore(page).switchMode("research");

    expect(result).toEqual({ ok: true, mode: "research" });
    expect(page.clicks.slice(0, 3)).toEqual([
      "button",
      "button",
      "item:Deep research",
    ]);
  });

  it("does not toggle an already open menu shut", async () => {
    const page = new FakeModePage({ menuOpen: true });

    const result = await new ModeCore(page).switchMode("research");

    expect(result).toEqual({ ok: true, mode: "research" });
    expect(page.clicks[0]).toBe("item:Deep research");
    expect(page.isMenuOpen).toBe(false);
  });

  it("closes the menu when the page fails while it is open", async () => {
    const page = new FakeModePage();
    page.failingScript = "locateModeMenuItem";
    const core = new ModeCore(page);

    const failure = failureOf(await core.switchMode("research"));

    expect(failure).toEqual({
      kind: "page-error",
      mode: "research",
      message: "Runtime.evaluate failed in locateModeMenuItem",
    });
    expect(page.isMenuOpen).toBe(false);
    expect(page.escapes).toBe(1);
    expect(core.rememberedMode).toBeUndefined();
  });

  it("fails when Escape does not close the menu, and does not remember the mode", async () => {
    const page = new FakeModePage();
    page.escapeCloses = false;
    const core = new ModeCore(page);

    const failure = failureOf(await core.switchMode("research"));

    expect(failure).toEqual({ kind: "menu-left-open", mode: "research" });
    expect(page.waitedMs).toBeLessThanOrEqual(WAIT_BOUND_MS);
    expect(core.rememberedMode).toBeUndefined();
  });

  it("keeps each core's remembered mode to itself", async () => {
    const first = new ModeCore(new FakeModePage());
    const second = new ModeCore(new FakeModePage({ current: "Deep research" }));

    await first.switchMode("research");
    await second.switchMode("search");

    expect(first.rememberedMode).toBe("research");
    expect(second.rememberedMode).toBe("search");
  });
});

describe("ModeCore.readMode", () => {
  it("reads the tool mode from the button without opening the menu", async () => {
    const page = new FakeModePage({ current: "Deep research" });
    const core = new ModeCore(page);

    const research = await core.readMode();
    page.navigateTo("Search");
    const search = await core.readMode();

    expect(research).toEqual({ kind: "known", mode: "research" });
    expect(search).toEqual({ kind: "known", mode: "search" });
    expect(page.clicks).toEqual([]);
    expect(page.escapes).toBe(0);
  });

  it("returns unknown with the text it saw, and makes no click", async () => {
    const page = new FakeModePage({ current: "Learn step by step" });

    const reading = await new ModeCore(page).readMode();

    expect(reading).toEqual({ kind: "unknown", text: "Learn step by step" });
    expect(page.clicks).toEqual([]);
  });

  it("reports that no button was found, within the bounded wait", async () => {
    const page = new FakeModePage({ hasButton: false });

    const reading = await new ModeCore(page).readMode();

    expect(reading).toEqual({ kind: "no-button" });
    expect(page.clicks).toEqual([]);
    expect(page.waitedMs).toBeLessThanOrEqual(WAIT_BOUND_MS);
  });

  it("returns a page error with its message rather than throwing", async () => {
    const page = new FakeModePage();
    page.failingScript = "locateModeButton";

    const reading = await new ModeCore(page).readMode();

    expect(reading).toEqual({
      kind: "page-error",
      message: "Runtime.evaluate failed in locateModeButton",
    });
    expect(page.clicks).toEqual([]);
  });
});

describe("ModeCore.ensureMode", () => {
  it("does nothing when no mode is remembered", async () => {
    const page = new FakeModePage();

    const outcome = await new ModeCore(page).ensureMode();

    expect(outcome).toEqual({ status: "no-mode" });
    expect(page.scriptsRun).toEqual([]);
  });

  it("does nothing more than read when the page is already in the remembered mode", async () => {
    const page = new FakeModePage();
    const core = new ModeCore(page);
    await core.switchMode("research");
    const clicksBefore = page.clicks.length;

    const outcome = await core.ensureMode();

    expect(outcome).toEqual({ status: "already-set", mode: "research" });
    expect(page.clicks.length).toBe(clicksBefore);
  });

  it("re-applies the remembered mode when the page has lost it", async () => {
    const page = new FakeModePage();
    const core = new ModeCore(page);
    await core.switchMode("research");
    page.navigateTo("Search");

    const outcome = await core.ensureMode();

    expect(outcome).toEqual({ status: "applied", mode: "research" });
    expect(page.checked).toBe("Deep research");
    expect(page.isMenuOpen).toBe(false);
  });

  it("reports a failed re-apply with its reason, and keeps the remembered mode", async () => {
    const page = new FakeModePage();
    const core = new ModeCore(page);
    await core.switchMode("research");
    page.navigateTo("Search");
    page.selectionTakes = false;

    const outcome = await core.ensureMode();

    expect(outcome).toEqual({
      status: "failed",
      mode: "research",
      failure: {
        kind: "read-back-mismatch",
        mode: "research",
        label: "Deep research",
        checkedLabel: "Search",
        buttonText: "Search",
      },
    });
    expect(core.rememberedMode).toBe("research");
    expect(page.isMenuOpen).toBe(false);
  });

  it("reports a failure when the page shows no mode button", async () => {
    const page = new FakeModePage();
    const core = new ModeCore(page);
    await core.switchMode("research");
    page.removeButton();
    const clicksBefore = page.clicks.length;

    const outcome = await core.ensureMode();

    expect(outcome).toEqual({
      status: "failed",
      mode: "research",
      failure: { kind: "no-button", mode: "research" },
    });
    expect(page.clicks.length).toBe(clicksBefore);
    expect(page.waitedMs).toBeLessThanOrEqual(2 * WAIT_BOUND_MS);
  });

  it("reports a page error as a failed re-apply rather than throwing", async () => {
    const page = new FakeModePage();
    const core = new ModeCore(page);
    await core.switchMode("research");
    page.failingScript = "locateModeButton";

    const outcome = await core.ensureMode();

    expect(outcome).toEqual({
      status: "failed",
      mode: "research",
      failure: {
        kind: "page-error",
        mode: "research",
        message: "Runtime.evaluate failed in locateModeButton",
      },
    });
  });
});

describe("describeModeFailure", () => {
  it("states an invalid mode with today's error text", () => {
    expect(
      describeModeFailure(
        { kind: "invalid-mode", input: "invalid_mode_xyz" },
        quote,
      ),
    ).toBe(
      "Invalid mode: invalid_mode_xyz. Use: search, research, labs, learn",
    );
  });

  it("states an unselectable mode with the catalogue's reason", () => {
    expect(
      describeModeFailure(
        {
          kind: "not-selectable",
          mode: "labs",
          reason: "not offered by Perplexity's current input bar",
        },
        quote,
      ),
    ).toBe(
      "Cannot switch to labs mode: not offered by Perplexity's current input bar",
    );
  });

  it("states a missing button", () => {
    expect(
      describeModeFailure({ kind: "no-button", mode: "research" }, quote),
    ).toBe("Cannot switch to research mode: no mode button found on the page");
  });

  it("passes the page's text through the quoting function, and only that", () => {
    const failures: ModeFailure[] = [
      { kind: "menu-did-not-open", mode: "research", buttonText: "Srch" },
      {
        kind: "item-missing",
        mode: "research",
        label: "Deep research",
        labelsPresent: ["Search", "Learn"],
      },
      {
        kind: "read-back-mismatch",
        mode: "research",
        label: "Deep research",
        checkedLabel: "Search",
        buttonText: "Search",
      },
      { kind: "page-error", mode: "research", message: "boom" },
    ];

    expect(
      failures.map((failure) => describeModeFailure(failure, quote)),
    ).toEqual([
      "Cannot switch to research mode: the mode menu did not open (the mode button reads <<Srch>>)",
      'Cannot switch to research mode: the mode menu has no "Deep research" item (items present: <<Search, Learn>>)',
      'Cannot switch to research mode: after selecting "Deep research" the menu has <<Search>> checked and the mode button reads <<Search>>',
      "Cannot switch to research mode: the page failed: <<boom>>",
    ]);
  });

  it("states a read-back with no item checked", () => {
    expect(
      describeModeFailure(
        {
          kind: "read-back-mismatch",
          mode: "research",
          label: "Deep research",
          checkedLabel: null,
          buttonText: "Search",
        },
        quote,
      ),
    ).toBe(
      'Cannot switch to research mode: after selecting "Deep research" the menu has no item checked and the mode button reads <<Search>>',
    );
  });

  it("states a menu that stayed open", () => {
    expect(
      describeModeFailure({ kind: "menu-left-open", mode: "search" }, quote),
    ).toBe("Cannot switch to search mode: the mode menu did not close");
  });
});

describe("src/core/mode.ts", () => {
  const source = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "src",
      "core",
      "mode.ts",
    ),
    "utf8",
  );

  it("imports only the mode catalogue, the page scripts and the error-message helper, never an adapter or the CDP client", () => {
    const imported = [
      ...source.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g),
    ].map((match) => match[1]);

    expect(new Set(imported)).toEqual(
      new Set(["../error-message.js", "../modes.js", "../page-scripts.js"]),
    );
  });

  it("never builds page script text itself", () => {
    expect(source).not.toMatch(/pageScriptExpression|Runtime|evaluate\(/);
  });
});
