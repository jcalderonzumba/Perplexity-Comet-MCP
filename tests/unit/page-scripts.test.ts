// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
  extractAgentStatus,
  locateModeButton,
  locateModeMenuItem,
  locateStopControl,
  locateSubmitButton,
  type PageArgument,
  pageScriptExpression,
  readAskInput,
  readModeMenuItems,
  readThreadState,
  selectAskInput,
} from "../../src/page-scripts.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

/**
 * jsdom does not compute layout, so `offsetParent` is always `null`. The
 * stop-button check `extractAgentStatus` had before the stop control counted
 * only buttons whose `offsetParent` was set; the tests that show a button is
 * not the stop control mark it visible, so that check would have taken it.
 */
function markVisible(el: HTMLElement): void {
  Object.defineProperty(el, "offsetParent", {
    configurable: true,
    get() {
      return el.parentElement || document.body;
    },
  });
}

// Without turn markup, the thread state falls back to the page's prose
// elements: how many there are, and the start of the last one.
describe("readThreadState on a page that shows no turn", () => {
  it("reads no turn, no prose and no text on an empty page", () => {
    expect(readThreadState()).toEqual({
      latestTurn: null,
      proseCount: 0,
      lastProseText: "",
    });
  });

  it("counts the prose elements and reads the last one's text", () => {
    document.body.innerHTML = `
      <div class="prose">first</div>
      <div class="prose-md">middle</div>
      <div class="prose">last block</div>
    `;
    expect(readThreadState()).toEqual({
      latestTurn: null,
      proseCount: 3,
      lastProseText: "last block",
    });
  });

  it("reads the first 100 characters of the last prose element", () => {
    document.body.innerHTML = `<div class="prose">${"x".repeat(250)}</div>`;
    expect(readThreadState().lastProseText).toBe("x".repeat(100));
  });
});

describe("extractAgentStatus", () => {
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
    loadAskInputFixture();
    showStopControl();
    const step = document.createElement("div");
    step.textContent = "Finished reading sources";
    document.body.prepend(step);

    // The stop control shows -> still working, regardless of "Finished reading".
    expect(runInPage(extractAgentStatus).status).toBe("working");
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

// The input bar and its Submit button, on a fixture of the live home page
// with a prompt typed in.

const ASK_INPUT_FIXTURE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures", "ask-input.html"),
  "utf8",
);

const FIXTURE_PROMPT = "What is the capital of France?";

function loadAskInputFixture(): void {
  document.body.innerHTML = ASK_INPUT_FIXTURE;
}

function askInput(): HTMLElement {
  return document.getElementById("ask-input") as HTMLElement;
}

function submitButton(): HTMLButtonElement {
  return document.querySelector(
    'button[aria-label="Submit"]',
  ) as HTMLButtonElement;
}

/** A page whose input bar is a textarea holding `value`, as older pages had. */
function loadTextareaInputBar(value: string): HTMLTextAreaElement {
  document.body.innerHTML = `<form><textarea placeholder="Ask anything"></textarea><button aria-label="Submit" type="button"></button></form>`;
  const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
  textarea.value = value;
  return textarea;
}

describe("selectAskInput", () => {
  beforeEach(loadAskInputFixture);

  it("focuses the input bar and selects everything in it, so inserted text replaces it", () => {
    expect(runInPage(selectAskInput)).toBe(true);

    expect(document.activeElement).toBe(askInput());
    expect(window.getSelection()?.toString().trim()).toBe(FIXTURE_PROMPT);
  });

  it("selects the whole value of a textarea input bar", () => {
    const textarea = loadTextareaInputBar("a draft");

    expect(runInPage(selectAskInput)).toBe(true);

    expect(document.activeElement).toBe(textarea);
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([0, 7]);
  });

  it("returns false, focusing and selecting nothing, on a page without an input bar", () => {
    document.body.innerHTML = "<main><p>An article</p></main>";

    expect(runInPage(selectAskInput)).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });

  it("never takes an editable region that is not a text box for the input bar", () => {
    document.body.innerHTML = `<div contenteditable="true">notes</div>`;

    expect(runInPage(selectAskInput)).toBe(false);
  });
});

describe("readAskInput", () => {
  beforeEach(loadAskInputFixture);

  it("returns the text the input bar holds", () => {
    expect(runInPage(readAskInput)?.trim()).toBe(FIXTURE_PROMPT);
  });

  it("returns what an empty input bar holds: no text", () => {
    askInput().innerHTML = '<p dir="auto"><br></p>';

    expect(runInPage(readAskInput)).toBe("");
  });

  it("returns a textarea input bar's value", () => {
    loadTextareaInputBar("a draft");

    expect(runInPage(readAskInput)).toBe("a draft");
  });

  it("returns null on a page without an input bar", () => {
    document.body.innerHTML = "<main><p>An article</p></main>";

    expect(runInPage(readAskInput)).toBeNull();
  });
});

describe("locateSubmitButton", () => {
  beforeEach(loadAskInputFixture);

  it("returns the centre point of the input bar's Submit button", () => {
    expect(runInPage(locateSubmitButton)).toEqual(anyPoint);
  });

  it("finds the Submit button beside a textarea input bar", () => {
    loadTextareaInputBar("a draft");

    expect(runInPage(locateSubmitButton)).toEqual(anyPoint);
  });

  it("returns null when the input bar shows no Submit button, as with an empty field", () => {
    submitButton().remove();

    expect(runInPage(locateSubmitButton)).toBeNull();
  });

  it("returns null when the Submit button is disabled", () => {
    submitButton().disabled = true;

    expect(runInPage(locateSubmitButton)).toBeNull();
  });

  it("returns null on a page without an input bar, whatever buttons it has", () => {
    document.body.innerHTML = `<main><button aria-label="Submit" type="button"></button></main>`;

    expect(runInPage(locateSubmitButton)).toBeNull();
  });

  it("never takes a Submit button far from the input bar", () => {
    submitButton().remove();
    const far = document.createElement("div");
    far.innerHTML = `<button aria-label="Submit" type="button"></button>`;
    let deep: HTMLElement = document.body;
    for (let level = 0; level < 8; level++) {
      const wrapper = document.createElement("div");
      deep.appendChild(wrapper);
      deep = wrapper;
    }
    deep.appendChild(askInput());
    document.body.appendChild(far);

    expect(runInPage(locateSubmitButton)).toBeNull();
  });
});

// The stop control: while Perplexity answers, its input bar shows a button
// labelled "Stop response (Esc)" with a filled stop icon where the Submit
// button sits, as Perplexity's input bar script renders it (read from the
// script the page loads, 2026-09-26). Two other buttons share its icon and
// are never the stop control: "Stop dictation", in the input bar while
// dictating, and the "Stop" of the answer's read-aloud player.

const STOP_ICON = `<svg role="img" aria-hidden="true"><use xlink:href="#pplx-icon-player-stop-filled"></use></svg>`;

function iconButton(label: string, icon = STOP_ICON): string {
  return `<button aria-label="${label}" type="button"><div><div>${icon}</div><div></div></div></button>`;
}

/** The input bar as Perplexity shows it while an answer is streaming. */
function showStopControl(): void {
  submitButton().outerHTML = iconButton("Stop response (Esc)");
}

/** Replaces the Submit button with `markup`, beside the input bar. */
function replaceSubmitButtonWith(markup: string): void {
  submitButton().outerHTML = markup;
}

/** An "Expand pane"-style button: a labelled icon drawn with an SVG rect. */
const RECT_ICON_BUTTON = `<button aria-label="Expand pane" type="button"><svg><rect width="10" height="10"></rect></svg></button>`;

describe("locateStopControl", () => {
  beforeEach(loadAskInputFixture);

  it("returns the centre point of the input bar's stop control", () => {
    showStopControl();

    expect(runInPage(locateStopControl)).toEqual(anyPoint);
  });

  it("returns null when the input bar shows Submit, as when no answer is streaming", () => {
    expect(runInPage(locateStopControl)).toBeNull();
  });

  it("never takes a button with an SVG rect for the stop control", () => {
    replaceSubmitButtonWith(RECT_ICON_BUTTON);

    expect(runInPage(locateStopControl)).toBeNull();
  });

  it("never takes the input bar's Stop dictation button for the stop control", () => {
    replaceSubmitButtonWith(iconButton("Stop dictation"));

    expect(runInPage(locateStopControl)).toBeNull();
  });

  it.each([
    ["the read-aloud player's Stop", "Stop"],
    ["a Cancel button", "Cancel"],
    [
      "a label that only contains the stop control's",
      "Stop response (Esc) now",
    ],
  ])("never takes %s for the stop control", (_case, label) => {
    replaceSubmitButtonWith(iconButton(label));

    expect(runInPage(locateStopControl)).toBeNull();
  });

  it("never takes a stop-labelled button far from the input bar", () => {
    document.body.innerHTML = `<main><div>${iconButton("Stop response (Esc)")}</div></main>`;

    expect(runInPage(locateStopControl)).toBeNull();
  });
});

describe("extractAgentStatus and the stop control", () => {
  beforeEach(loadAskInputFixture);

  it("reads the stop control as an answer in progress", () => {
    showStopControl();

    expect(runInPage(extractAgentStatus)).toMatchObject({
      status: "working",
      hasStopButton: true,
    });
  });

  it.each([
    ["an Expand pane-style button with an SVG rect", RECT_ICON_BUTTON],
    ["the Stop dictation button", iconButton("Stop dictation")],
    ["the read-aloud player's Stop button", iconButton("Stop")],
  ])("never reads %s as the stop control", (_case, markup) => {
    replaceSubmitButtonWith(markup);
    for (const button of document.querySelectorAll("button")) {
      markVisible(button);
    }

    expect(runInPage(extractAgentStatus).hasStopButton).toBe(false);
  });
});

// The answer, on fixtures of live threads: Perplexity lays a thread out as a
// flat list of blocks, each question in a `data-workflow-entry` block and
// its answer in the `data-workflow-final-text` block after it.

function readFixture(name: string): string {
  return readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "fixtures", name),
    "utf8",
  );
}

const ONE_WORD_THREAD = readFixture("thread-one-word.html");
const SEVERAL_TURNS_THREAD = readFixture("thread-several-turns.html");

/** "Answer <turn> part <from>. … Answer <turn> part <to>.", as invented. */
function parts(turn: number, from: number, to = from): string {
  const numbers = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  return numbers.map((part) => `Answer ${turn} part ${part}.`).join(" ");
}

/** Turn 4's answer, the latest in the several-turn fixture. */
const TURN_4_ANSWER = [
  parts(4, 1),
  "Heading 4.2",
  parts(4, 3),
  parts(4, 4),
  parts(4, 5, 11),
  parts(4, 12, 19),
  parts(4, 20, 24),
  parts(4, 25, 27),
  parts(4, 28),
  parts(4, 29, 33),
  parts(4, 34),
  parts(4, 35, 36),
  parts(4, 37),
].join("\n\n");

/** Turn 3's answer: headings, two lists, and a line break in a paragraph. */
const TURN_3_ANSWER = [
  parts(3, 1),
  "Heading 3.2",
  parts(3, 3),
  `- ${parts(3, 4)}`,
  `- ${parts(3, 5)}`,
  parts(3, 6),
  "Heading 3.7",
  `${parts(3, 8, 10)}\n${parts(3, 11)}`,
  `- ${parts(3, 12)}`,
  `- ${parts(3, 13)}`,
  parts(3, 14),
].join("\n\n");

function answerBlocks(): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>("[data-workflow-final-text]"),
  ];
}

function latestAnswerRoot(): HTMLElement {
  return answerBlocks().at(-1)?.querySelector(".prose") as HTMLElement;
}

/** Removes turn 4, question and answer, leaving turn 3 the latest. */
function removeTurn4(): void {
  document.querySelector('[data-workflow-entry="4"]')?.remove();
  answerBlocks().at(-1)?.remove();
}

describe("extractAgentStatus reads the latest turn's answer", () => {
  it("reads a one-word answer as a completed answer", () => {
    document.body.innerHTML = ONE_WORD_THREAD;

    expect(runInPage(extractAgentStatus)).toMatchObject({
      status: "completed",
      response: "Paris",
      hasStopButton: false,
    });
  });

  it("keeps an answer that starts with a UI label's word", () => {
    document.body.innerHTML = ONE_WORD_THREAD;
    latestAnswerRoot().innerHTML = "<p>Search results show three vendors.</p>";

    expect(runInPage(extractAgentStatus).response).toBe(
      "Search results show three vendors.",
    );
  });

  it("returns every paragraph of a long answer, headings included, citation chips left out", () => {
    document.body.innerHTML = SEVERAL_TURNS_THREAD;

    expect(runInPage(extractAgentStatus)).toMatchObject({
      status: "completed",
      response: TURN_4_ANSWER,
    });
  });

  it("returns only the latest turn's answer in a thread of several turns", () => {
    document.body.innerHTML = SEVERAL_TURNS_THREAD;

    const { response } = runInPage(extractAgentStatus);

    expect(response).toContain(parts(4, 1));
    expect(response).not.toContain("Answer 3");
    expect(response).not.toContain("Answer 2");
  });

  it("returns each list item of an answer, with the paragraphs around the list", () => {
    document.body.innerHTML = SEVERAL_TURNS_THREAD;
    removeTurn4();

    expect(runInPage(extractAgentStatus).response).toBe(TURN_3_ANSWER);
  });

  it("never returns an earlier turn's answer while the latest turn has none yet", () => {
    document.body.innerHTML = SEVERAL_TURNS_THREAD;
    answerBlocks().at(-1)?.remove();

    const result = runInPage(extractAgentStatus);

    expect(result.status).not.toBe("completed");
    expect(result.response).toBe("");
  });

  it("never cuts a long answer", () => {
    document.body.innerHTML = ONE_WORD_THREAD;
    const long = "word ".repeat(5000).trim();
    latestAnswerRoot().innerHTML = `<p>${long}</p>`;

    expect(runInPage(extractAgentStatus).response).toBe(long);
  });

  it("reads a code block's code, and not its caption or copy button", () => {
    document.body.innerHTML = ONE_WORD_THREAD;
    // A code block as the live page renders one, trimmed to structure.
    latestAnswerRoot().innerHTML = `<p>Run this:</p><div><pre><figure><figcaption><span>text</span><div><button aria-label="Copy code" type="button"></button></div></figcaption><span><code>const a = 1;\n  const b = 2;\n</code></span></figure></pre></div>`;

    expect(runInPage(extractAgentStatus).response).toBe(
      "Run this:\n\nconst a = 1;\n  const b = 2;",
    );
  });

  it("numbers the items of an ordered list", () => {
    document.body.innerHTML = ONE_WORD_THREAD;
    latestAnswerRoot().innerHTML = `<p>Steps:</p><ol><li><p>Open it.</p></li><li><p>Read it.</p></li></ol>`;

    expect(runInPage(extractAgentStatus).response).toBe(
      "Steps:\n\n1. Open it.\n\n2. Read it.",
    );
  });

  it("reads a table row by row, cells apart", () => {
    document.body.innerHTML = ONE_WORD_THREAD;
    latestAnswerRoot().innerHTML = `<table><thead><tr><th>City</th><th>Country</th></tr></thead><tbody><tr><td>Paris</td><td>France</td></tr></tbody></table>`;

    expect(runInPage(extractAgentStatus).response).toBe(
      "City | Country\n\nParis | France",
    );
  });

  it("reads the last answer block of a page without turn blocks, never navigation or a UI label", () => {
    document.body.innerHTML = `
      <nav><div class="prose">A navigation entry long enough to pass for text</div></nav>
      <main>
        <div class="prose">Rome.</div>
        <div class="prose">Library</div>
      </main>
      <div>Ask a follow-up</div>`;

    expect(runInPage(extractAgentStatus)).toMatchObject({
      status: "completed",
      response: "Rome.",
    });
  });
});

// The latest turn, by the index each question block carries: a hidden tab
// renders only the turns near the view, so the index, not a count of the
// blocks, says which turn is the latest.
describe("readThreadState on a thread", () => {
  it("reads the latest turn's index from its question block", () => {
    document.body.innerHTML = SEVERAL_TURNS_THREAD;

    expect(runInPage(readThreadState).latestTurn).toBe(4);
  });

  it("reads turn 0 on a thread of one turn", () => {
    document.body.innerHTML = ONE_WORD_THREAD;

    expect(runInPage(readThreadState).latestTurn).toBe(0);
  });

  it("reads a new turn as soon as its question shows, before its answer", () => {
    document.body.innerHTML = SEVERAL_TURNS_THREAD;
    const question = document.createElement("div");
    question.setAttribute("data-workflow-entry", "5");
    question.textContent = "The next question";
    answerBlocks().at(-1)?.after(question);

    expect(runInPage(readThreadState).latestTurn).toBe(5);
  });

  it("reads the highest index, whatever order the blocks are in", () => {
    document.body.innerHTML = `
      <div data-workflow-entry="7">q</div>
      <div data-workflow-entry="12">q</div>
      <div data-workflow-entry="9">q</div>
    `;

    expect(runInPage(readThreadState).latestTurn).toBe(12);
  });

  it("reads no turn on Perplexity's home page", () => {
    loadAskInputFixture();

    expect(runInPage(readThreadState).latestTurn).toBeNull();
  });

  it("ignores a question block whose index is not a number", () => {
    document.body.innerHTML = `<div data-workflow-entry="">q</div><div data-workflow-entry="x">q</div>`;

    expect(runInPage(readThreadState).latestTurn).toBeNull();
  });
});
