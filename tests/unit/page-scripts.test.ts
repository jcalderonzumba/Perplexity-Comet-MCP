// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
  extractAgentStatus,
  locateModeButton,
  locateModeMenuItem,
  type PageArgument,
  pageScriptExpression,
  readModeMenuItems,
  readPageAddress,
  readProseState,
} from "../../src/page-scripts.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

/**
 * jsdom does not compute layout, so `offsetParent` is always `null`.
 * `extractAgentStatus` uses `offsetParent !== null` as a visibility check
 * for stop buttons. To exercise the "working" path we have to mark
 * specific elements as visible.
 */
function markVisible(el: HTMLElement): void {
  Object.defineProperty(el, "offsetParent", {
    configurable: true,
    get() {
      return el.parentElement || document.body;
    },
  });
}

describe("readPageAddress", () => {
  it("returns the address of the page it runs in", () => {
    window.history.pushState({}, "", "/search/a-thread?q=1");

    expect(readPageAddress()).toBe(
      `${window.location.origin}/search/a-thread?q=1`,
    );
  });
});

describe("readProseState", () => {
  it("returns count=0 and empty lastText for an empty DOM", () => {
    const state = readProseState();
    expect(state).toEqual({ count: 0, lastText: "" });
  });

  it("returns the count and full lastText (under 100 chars) for one prose block", () => {
    document.body.innerHTML = `<div class="prose">Short answer here.</div>`;
    const state = readProseState();
    expect(state.count).toBe(1);
    expect(state.lastText).toBe("Short answer here.");
  });

  it("returns the last prose block's text when several are present", () => {
    document.body.innerHTML = `
      <div class="prose">first</div>
      <div class="prose-md">middle</div>
      <div class="prose">last block</div>
    `;
    const state = readProseState();
    expect(state.count).toBe(3);
    expect(state.lastText).toBe("last block");
  });

  it("truncates lastText at 100 characters", () => {
    const longText = "x".repeat(250);
    document.body.innerHTML = `<div class="prose">${longText}</div>`;
    const state = readProseState();
    expect(state.count).toBe(1);
    expect(state.lastText.length).toBe(100);
    expect(state.lastText).toBe("x".repeat(100));
  });
});

describe("extractAgentStatus", () => {
  it("returns 'working' when a visible stop button is present", () => {
    document.body.innerHTML = `<button aria-label="Stop">stop</button>`;
    const btn = document.querySelector("button") as HTMLButtonElement;
    markVisible(btn);

    const result = extractAgentStatus();
    expect(result.status).toBe("working");
    expect(result.hasStopButton).toBe(true);
  });

  it("returns 'completed' when 'Reviewed N sources' is present, prose has content, no stop button", () => {
    document.body.innerHTML = `
      <main>
        <div>Reviewed 12 sources</div>
        <div class="prose">This is the agent's final answer with enough length to clear the threshold for prose detection in the extractor.</div>
        <button aria-label="New chat">New</button>
      </main>
    `;

    const result = extractAgentStatus();
    expect(result.status).toBe("completed");
    expect(result.hasStopButton).toBe(false);
    expect(result.response.length).toBeGreaterThan(0);
  });

  it("returns 'completed' for Russian singular 'Выполнен 1 шаг'", () => {
    const main = document.createElement("main");
    const m = document.createElement("div");
    m.textContent = "Выполнен 1 шаг";
    const p = document.createElement("div");
    p.className = "prose";
    p.textContent = "Готовый ответ агента, длина превышает 15 символов.";
    main.append(m, p);
    document.body.append(main);

    const result = extractAgentStatus();
    expect(result.status).toBe("completed");
  });

  it("returns 'completed' for Russian plural 'Выполнено 5 шагов'", () => {
    const main = document.createElement("main");
    const m = document.createElement("div");
    m.textContent = "Выполнено 5 шагов";
    const p = document.createElement("div");
    p.className = "prose";
    p.textContent = "Готовый ответ агента, длина превышает 15 символов.";
    main.append(m, p);
    document.body.append(main);

    const result = extractAgentStatus();
    expect(result.status).toBe("completed");
  });

  it("does NOT treat 'Finished reading sources' as a completion marker", () => {
    const main = document.createElement("main");
    const m = document.createElement("div");
    m.textContent = "Finished reading sources";
    const btn = document.createElement("button");
    btn.setAttribute("aria-label", "Stop");
    btn.textContent = "stop";
    main.append(m, btn);
    document.body.append(main);
    markVisible(btn);

    const result = extractAgentStatus();
    // Stop button visible -> still working, regardless of "Finished reading".
    expect(result.status).toBe("working");
  });

  it("picks the response after the LAST 'steps completed' marker", () => {
    // Multi-turn chat: the older turn's marker must NOT win over the newer one.
    const main = document.createElement("main");
    const turn1 = document.createElement("div");
    turn1.textContent =
      "3 steps completed Previous turn answer text here, long enough to exceed thresholds easily. Ask anything";
    const turn2 = document.createElement("div");
    turn2.textContent =
      "5 steps completed New turn answer that we actually want returned to the caller. Ask a follow-up";
    main.append(turn1, turn2);
    document.body.append(main);

    const result = extractAgentStatus();
    expect(result.status).toBe("completed");
    expect(result.response).toContain("New turn answer");
    expect(result.response).not.toContain("Previous turn answer");
  });

  it("extracts and dedupes step descriptions matching the working patterns", () => {
    // Pattern matching runs against document.body.innerText.
    // Use one step per <div> so jsdom's innerText emits one per line.
    document.body.innerHTML = `
      <div>Searching for vegan ingredients</div>
      <div>Reading product details</div>
      <div>Searching for vegan ingredients</div>
      <div>Navigating to checkout</div>
    `;

    const result = extractAgentStatus();
    // After Set-dedupe, three unique steps remain.
    expect(result.steps.length).toBe(3);
    expect(result.steps).toEqual(
      expect.arrayContaining([
        "Searching for vegan ingredients",
        "Reading product details",
        "Navigating to checkout",
      ]),
    );
    // currentStep should be the most recently matched step.
    expect(result.currentStep).toMatch(/Searching for|Reading|Navigating/);
  });
});

// The mode scripts below are run as production runs them: the expression
// `pageScriptExpression` builds, evaluated by an indirect eval in the global
// scope, detached from this module. A script that closed over anything but
// DOM globals would throw a ReferenceError here.

const MODE_MENU_FIXTURE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures", "mode-menu.html"),
  "utf8",
);

/** Runs an expression as `Runtime.evaluate` does: global scope, no module. */
function evaluateInPage(expression: string): unknown {
  // biome-ignore lint/security/noGlobalEval: the test runs page expressions as CDP's Runtime.evaluate does
  return globalThis.eval(expression);
}

function runInPage<A extends PageArgument[], R>(
  script: (...args: A) => R,
  ...args: A
): R {
  return evaluateInPage(pageScriptExpression(script, ...args)) as R;
}

function loadModeMenuFixture(): void {
  document.body.innerHTML = MODE_MENU_FIXTURE;
}

function modeButton(): HTMLButtonElement {
  return document.getElementById("radix-_r_u_") as HTMLButtonElement;
}

function modeMenu(): HTMLElement {
  return document.getElementById("radix-_r_v_") as HTMLElement;
}

/** The live page's closed state: the menu stays in the DOM, marked closed. */
function closeModeMenu(): void {
  modeButton().setAttribute("data-state", "closed");
  modeButton().removeAttribute("aria-controls");
  modeMenu().setAttribute("data-state", "closed");
}

function addMenuItem(label: string, checked = false): void {
  const item = document.createElement("div");
  item.setAttribute("role", "menuitemradio");
  item.setAttribute("aria-checked", String(checked));
  item.textContent = label;
  modeMenu().querySelector('[role="group"]')?.append(item);
}

/** Another open menu with radio items, as the Model menu could be. */
function addOtherOpenMenu(label: string): void {
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div role="menu" data-state="open" id="other-menu">
       <div role="menuitemradio" aria-checked="true">${label}</div>
     </div>`,
  );
}

const anyPoint = { x: expect.any(Number), y: expect.any(Number) };

describe("pageScriptExpression", () => {
  it("calls the script with no arguments", () => {
    const expression = pageScriptExpression(() => 42);
    expect(expression).toMatch(/\(\)$/);
    expect(evaluateInPage(expression)).toBe(42);
  });

  it("delivers a string with quotes, backslashes and </script> unchanged", () => {
    const hostile =
      'He said "hi" and \'bye\' \\ \\" `x` </script><script>alert(1)</script>\n  ';
    expect(runInPage((value: string) => value, hostile)).toBe(hostile);
  });

  it("delivers several arguments of each JSON type in order", () => {
    const echo = (...values: PageArgument[]) => values;
    const args: PageArgument[] = [
      "text",
      3.5,
      false,
      null,
      ["a", 1],
      { nested: { label: "Deep research" } },
    ];
    expect(runInPage(echo, ...args)).toEqual(args);
  });

  it("never lets an argument close the call and run code of its own", () => {
    const injection = '"); globalThis.injected = true; ("';
    runInPage((value: string) => value, injection);
    expect((globalThis as { injected?: boolean }).injected).toBeUndefined();
  });
});

describe("locateModeButton", () => {
  beforeEach(loadModeMenuFixture);

  it("finds the mode button with its text, open state and centre point", () => {
    expect(runInPage(locateModeButton)).toEqual({
      text: "Search",
      open: true,
      point: anyPoint,
    });
  });

  it("reports the menu closed when the button's data-state is closed", () => {
    closeModeMenu();
    expect(runInPage(locateModeButton)).toMatchObject({ open: false });
  });

  it("reports the menu open when only aria-expanded says so", () => {
    closeModeMenu();
    modeButton().removeAttribute("data-state");
    modeButton().setAttribute("aria-expanded", "true");
    expect(runInPage(locateModeButton)).toMatchObject({ open: true });
  });

  it("returns the current mode's text with whitespace collapsed", () => {
    const label = modeButton().querySelector("span + span")?.firstChild;
    if (label) label.textContent = "\n   Deep \n  research  ";
    expect(runInPage(locateModeButton)).toMatchObject({
      text: "Deep research",
    });
  });

  it("returns null when the page has no mode button", () => {
    document.body.innerHTML = "<main><button>Search</button></main>";
    expect(runInPage(locateModeButton)).toBeNull();
  });

  it("never takes the Computer toggle beside it for the mode button", () => {
    modeButton().remove();
    expect(runInPage(locateModeButton)).toBeNull();
  });
});

describe("readModeMenuItems", () => {
  beforeEach(loadModeMenuFixture);

  it("reads the open mode menu's radio items, marking the checked one", () => {
    expect(runInPage(readModeMenuItems)).toEqual([
      { label: "Search", checked: true },
      { label: "Deep research", checked: false },
      { label: "Learn step by step", checked: false },
    ]);
  });

  it("returns null when the menu is closed, though it stays in the DOM", () => {
    closeModeMenu();
    expect(runInPage(readModeMenuItems)).toBeNull();
  });

  it("returns null when the page has no mode button", () => {
    modeButton().remove();
    expect(runInPage(readModeMenuItems)).toBeNull();
  });

  it("never reads another open menu's items", () => {
    addOtherOpenMenu("Deep research");
    closeModeMenu();
    expect(runInPage(readModeMenuItems)).toBeNull();
  });

  it("reads only the mode menu's items when another menu is open too", () => {
    addOtherOpenMenu("Some model");
    const labels = runInPage(readModeMenuItems)?.map((item) => item.label);
    expect(labels).toEqual(["Search", "Deep research", "Learn step by step"]);
  });
});

describe("locateModeMenuItem", () => {
  beforeEach(loadModeMenuFixture);

  it("returns the centre point of the item with exactly that label", () => {
    expect(runInPage(locateModeMenuItem, "Deep research")).toEqual(anyPoint);
  });

  it("compares labels after trimming and collapsing whitespace", () => {
    expect(runInPage(locateModeMenuItem, "  Deep \n research ")).toEqual(
      anyPoint,
    );
  });

  it.each([
    ["a shorter label inside it", "Research"],
    ["the old code's lowercase substring", "research"],
    ["a different case", "deep research"],
    ["a prefix", "Deep"],
    ["an absent label", "Labs"],
    ["an empty label", ""],
  ])("returns null for %s", (_case, label) => {
    expect(runInPage(locateModeMenuItem, label)).toBeNull();
  });

  it("never selects a plain menu item that is not a radio item", () => {
    expect(runInPage(locateModeMenuItem, "Model council")).toBeNull();
  });

  it("returns null when the menu is closed", () => {
    closeModeMenu();
    expect(runInPage(locateModeMenuItem, "Search")).toBeNull();
  });

  it("never selects an item from another open menu", () => {
    addOtherOpenMenu("Other mode");
    expect(runInPage(locateModeMenuItem, "Other mode")).toBeNull();
  });

  it("matches a label with quotes and markup literally", () => {
    const literal = `Say "hi" <b>it's</b> \\ </script>`;
    addMenuItem(literal);
    expect(runInPage(locateModeMenuItem, literal)).toEqual(anyPoint);
  });

  it("does not break on a label with quotes and markup that matches nothing", () => {
    const hostile = `"]'); document.body.remove(); ('<img src=x onerror=alert(1)>`;
    expect(runInPage(locateModeMenuItem, hostile)).toBeNull();
    expect(document.body).not.toBeNull();
    expect(runInPage(readModeMenuItems)).toHaveLength(3);
  });
});
