// Page-side scripts that run inside the Perplexity tab via CDP `evaluate`.
//
// Each function uses only browser globals (document, etc.) — never Node
// imports — so the same function body can run in two contexts:
//
//   - production: `cometClient.evaluate(pageScriptExpression(fn, ...args))`
//     ships the function body into the page, calls it with its arguments,
//     and returns its result through CDP
//   - tests: imported and called natively in vitest's jsdom env, or run
//     through `pageScriptExpression` exactly as production runs them
//
// One source of truth, type-checked by TypeScript, exercised by unit tests.
// Do not add closure references or imports beyond DOM APIs — the
// stringified form would break. A helper two scripts share is therefore
// written inside each of them.

/** A value a page script can receive: anything JSON can carry. */
export type PageArgument =
  | string
  | number
  | boolean
  | null
  | PageArgument[]
  | { [key: string]: PageArgument };

/**
 * The expression `evaluate` runs to call `script` in the page with `args`.
 * Each argument is JSON-serialised, so input reaches the page as data and
 * never as script text.
 */
export function pageScriptExpression<A extends PageArgument[]>(
  script: (...args: A) => unknown,
  ...args: A
): string {
  const serialisedArgs = args.map((arg) => JSON.stringify(arg)).join(", ");
  return `(${script.toString()})(${serialisedArgs})`;
}

/**
 * Which turn of the thread the page shows last. A thread is a flat list of
 * blocks, each question in a `data-workflow-entry` block that carries its
 * turn's index, the answer after it; a new question block shows as soon as
 * a prompt is submitted. A hidden tab renders only the turns near the view,
 * so the latest turn is the highest index, never a count of the blocks.
 */
export interface ThreadState {
  /** The latest turn's index, or null on a page that shows no turn. */
  latestTurn: number | null;
  /**
   * For a page that shows no turn: how many elements have a class naming
   * `prose`, and the first 100 characters of the last one.
   */
  proseCount: number;
  lastProseText: string;
}

export function readThreadState(): ThreadState {
  const indices = [...document.querySelectorAll("[data-workflow-entry]")]
    .map((entry) => entry.getAttribute("data-workflow-entry") ?? "")
    .filter((index) => /^\d+$/.test(index))
    .map(Number);
  const proseEls = document.querySelectorAll('[class*="prose"]');
  const lastProse = proseEls[proseEls.length - 1] as HTMLElement | undefined;
  return {
    latestTurn: indices.length > 0 ? Math.max(...indices) : null,
    proseCount: proseEls.length,
    lastProseText: lastProse ? lastProse.innerText.substring(0, 100) : "",
  };
}

export interface AgentStatusResult {
  status: "idle" | "working" | "completed";
  steps: string[];
  currentStep: string;
  response: string;
  hasStopButton: boolean;
}

export function extractAgentStatus(): AgentStatusResult {
  const body = document.body.innerText;

  // The input bar's buttons, up to the levels above it `locateStopControl`
  // searches, so the stop control is found as it finds it.
  const inputBarButtons = (): HTMLButtonElement[] => {
    const levelsUp = 6;
    const askInput =
      document.querySelector<HTMLElement>("#ask-input") ??
      document.querySelector<HTMLElement>(
        '[contenteditable="true"][role="textbox"]',
      ) ??
      document.querySelector<HTMLElement>("textarea");
    let container = askInput?.parentElement ?? null;
    for (let level = 1; container?.parentElement && level < levelsUp; level++) {
      container = container.parentElement;
    }
    return container ? [...container.querySelectorAll("button")] : [];
  };
  const labelOf = (button: Element): string =>
    (button.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim();
  const showsStopIcon = (button: Element): boolean =>
    [...button.querySelectorAll("use")].some(
      (use) =>
        (use.getAttribute("href") ?? use.getAttribute("xlink:href")) ===
        "#pplx-icon-player-stop-filled",
    );
  const nearInputBar = inputBarButtons();
  const hasActiveStopButton = nearInputBar.some(
    (button) => labelOf(button) === "Stop response (Esc)",
  );
  // On a page in another language the stop control's label is translated,
  // so its filled stop icon, which in the input bar only `Stop dictation`
  // shares, reads as an answer in progress too: never as complete.
  const hasStopIconBesideDictation = nearInputBar.some(
    (button) => showsStopIcon(button) && labelOf(button) !== "Stop dictation",
  );

  // More comprehensive loading detection
  const hasLoadingSpinner =
    document.querySelector(
      '[class*="animate-spin"], [class*="animate-pulse"], [class*="loading"], [class*="thinking"]',
    ) !== null;

  // Check for "Thinking" indicator specifically
  const hasThinkingIndicator =
    body.includes("Thinking") && !body.includes("Thinking about");

  // Completion markers — multilingual.
  // Perplexity localizes its UI (ru, de, es, fr, etc). English-only patterns
  // miss completion on non-English accounts, whose answers then never read
  // as complete. See PR #9 notes for marker source.
  const hasStepsCompleted =
    /\d+ steps? completed/i.test(body) ||
    // Russian agrees the verb with grammatical number:
    //   "Выполнен 1 шаг" (sg), "Выполнено 2/3/4 шага",
    //   "Выполнено 5+ шагов". The previous regex matched
    //   only "Выполнено …" and missed the singular case.
    /Выполнен(?:о|ы)?\s+\d+\s+шаг(?:а|ов)?/iu.test(body); // ru
  // Word-boundary the English marker and exclude "Finished reading|analyzing|…",
  // which is an *intermediate* step Perplexity renders while the agent is
  // still running. Without this, the agent flips to "completed" the moment
  // the first source is processed.
  const hasFinishedMarker =
    /\bFinished\b(?!\s+(?:reading|analyzing|browsing|searching|loading))/i.test(
      body,
    ) && !hasActiveStopButton;
  const hasReviewedSources = /Reviewed \d+ sources?/i.test(body);
  const hasSourcesIndicator =
    /\d+\s*sources?/i.test(body) || // en
    /\d+\s*источник(?:а|ов)?/iu.test(body); // ru
  const hasAskFollowUp =
    body.includes("Ask a follow-up") ||
    body.includes("Ask follow-up") ||
    body.includes("Задайте уточняющий вопрос") || // ru: input placeholder
    body.includes("Последующие вопросы"); // ru: section heading

  // The latest turn's answer. A thread is a flat list of blocks: each
  // question in a `data-workflow-entry` block, its answer in the
  // `data-workflow-final-text` block after it, as an element of class
  // `prose` (list items inside it carry classes that only contain the
  // word). The latest turn's answer is the answer block after the last
  // question; while that turn has none yet, there is no answer, and an
  // earlier turn's never stands in for it. A page without these blocks
  // falls back to its last `prose` element outside page chrome whose text
  // is not exactly a UI label.
  const outermostProse = (scope: ParentNode): Element[] =>
    [...scope.querySelectorAll(".prose")].filter(
      (element) => !element.parentElement?.closest(".prose"),
    );

  // Text is read block by block with `textContent`, so it does not depend
  // on layout: paragraphs, headings and list items and table rows apart,
  // a line break kept, a code block's code without its caption, and the
  // inline citation chips left out.
  const readAnswerText = (root: Element): string => {
    const blockTags =
      /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|DD|DIV|DL|DT|FIGURE|H[1-6]|HR|LI|OL|P|SECTION|TABLE|TBODY|TFOOT|THEAD|TR|UL)$/;
    const blocks: string[] = [];
    let line = "";
    let prefix = "";
    const flush = (): void => {
      const text = line
        .split("\n")
        .map((part) => part.replace(/\s+/g, " ").trim())
        .filter((part) => part !== "")
        .join("\n");
      if (text !== "") {
        blocks.push(prefix + text);
        prefix = "";
      }
      line = "";
    };
    const listPrefix = (item: Element): string => {
      const list = item.parentElement;
      if (list?.tagName !== "OL") return "- ";
      return `${[...list.children].indexOf(item) + 1}. `;
    };
    const walk = (node: Node): void => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          line += (child.textContent ?? "").replace(/\s+/g, " ");
          continue;
        }
        if (!(child instanceof Element)) continue;
        if (child.matches("[data-pplx-citation], button, svg")) continue;
        const tag = child.tagName;
        if (tag === "BR") {
          line += "\n";
        } else if (tag === "PRE") {
          flush();
          const code = (child.querySelector("code") ?? child).textContent ?? "";
          if (code.trim() !== "") blocks.push(code.replace(/\s+$/, ""));
        } else if (tag === "TD" || tag === "TH") {
          if (line.trim() !== "") line += " | ";
          walk(child);
        } else if (blockTags.test(tag)) {
          flush();
          if (tag === "LI") prefix = listPrefix(child);
          walk(child);
          flush();
          if (tag === "LI") prefix = "";
        } else {
          walk(child);
        }
      }
    };
    walk(root);
    flush();
    return blocks.join("\n\n");
  };

  const uiLabels = [
    "Library",
    "Discover",
    "Spaces",
    "Finance",
    "Account",
    "Upgrade",
    "Home",
    "Search",
  ];
  const lastAnswerOutsideChrome = (): Element[] => {
    const candidates = outermostProse(document).filter((element) => {
      if (
        element.closest("nav, aside, header, footer, form, [contenteditable]")
      )
        return false;
      const text = readAnswerText(element);
      return text !== "" && !uiLabels.includes(text);
    });
    const last = candidates[candidates.length - 1];
    return last ? [last] : [];
  };

  const latestAnswerRoots = (): Element[] => {
    const questions = [...document.querySelectorAll("[data-workflow-entry]")];
    const answers = [
      ...document.querySelectorAll("[data-workflow-final-text]"),
    ];
    if (questions.length === 0 && answers.length === 0) {
      return lastAnswerOutsideChrome();
    }
    const lastQuestion = questions[questions.length - 1];
    const answersAfter = answers.filter(
      (answer) =>
        !lastQuestion ||
        (lastQuestion.compareDocumentPosition(answer) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
          0,
    );
    const latest = answersAfter[answersAfter.length - 1];
    return latest ? outermostProse(latest) : [];
  };

  const answer = latestAnswerRoots()
    .map(readAnswerText)
    .filter((text) => text !== "")
    .join("\n\n");
  const hasAnswer = answer !== "";

  const workingPatterns = [
    "Working",
    "Searching",
    "Reviewing sources",
    "Preparing to assist",
    "Clicking",
    "Typing:",
    "Navigating to",
    "Reading",
    "Analyzing",
    "Browsing",
    "Looking at",
    "Checking",
    "Opening",
    "Scrolling",
    "Waiting",
    "Processing",
  ];
  const hasWorkingText = workingPatterns.some((p) => body.includes(p));

  // Determine status with improved logic
  let status: "idle" | "working" | "completed" = "idle";

  // FIRST: Check if actively working (stop button is the strongest indicator)
  if (hasActiveStopButton || hasStopIconBesideDictation) {
    status = "working";
  } else if (hasLoadingSpinner || hasThinkingIndicator) {
    status = "working";
  }
  // SECOND: Check completion indicators BEFORE working text
  // (because completed pages still show historical step text)
  else if (hasStepsCompleted || hasFinishedMarker) {
    status = "completed";
  } else if (hasAskFollowUp && hasAnswer) {
    status = "completed";
  } else if (hasSourcesIndicator && hasAnswer && !hasActiveStopButton) {
    status = "completed";
  } else if (hasReviewedSources && !hasActiveStopButton) {
    status = "completed";
  }
  // THIRD: Fall back to working text patterns (only if no completion signals)
  else if (hasWorkingText) {
    status = "working";
  }

  // Extract steps
  const steps: string[] = [];
  const stepPatterns = [
    /Preparing to assist[^\n]*/g,
    /Clicking[^\n]*/g,
    /Typing:[^\n]*/g,
    /Navigating[^\n]*/g,
    /Reading[^\n]*/g,
    /Searching[^\n]*/g,
    /Found[^\n]*/g,
  ];
  for (const pattern of stepPatterns) {
    const matches = body.match(pattern);
    if (matches) steps.push(...matches.map((s) => s.trim().substring(0, 100)));
  }

  // The answer whole, with no length limit: an answer is never cut.
  const response = status === "completed" ? answer : "";

  return {
    status,
    steps: [...new Set(steps)].slice(-5),
    currentStep: steps.length > 0 ? steps[steps.length - 1] : "",
    response,
    hasStopButton: hasActiveStopButton,
  };
}

// The mode control: Perplexity's input bar shows the current mode on a
// button ("Search", "Deep research") that opens the mode menu, a
// `role="menu"` of `menuitemradio` items. As read from the live page on
// 2026-09-24: the button sits in the input bar's mode-toggle wrapper beside
// the "Computer" toggle, and is the one of the two that controls a menu
// (`data-state` open or closed; `aria-expanded` as Radix sets it elsewhere).
// While the menu is open the button's `aria-controls` names it; once closed
// the menu can stay in the DOM marked `data-state="closed"`, so it is only
// ever reached through an open button. Labels are read with `textContent`
// and compared exactly after trimming and collapsing whitespace.

/** A point in the page's viewport, in CSS pixels. */
export interface PagePoint {
  x: number;
  y: number;
}

export interface ModeButton {
  /** The current mode's label as the button shows it. */
  text: string;
  /** Whether the mode menu is open. */
  open: boolean;
  point: PagePoint;
}

export interface ModeMenuItem {
  label: string;
  checked: boolean;
}

/** The mode button, or null when the page shows none. */
export function locateModeButton(): ModeButton | null {
  const wrapper = '[data-testid="ask-input-mode-toggle-width-wrapper"]';
  const button = document.querySelector(
    `${wrapper} button[data-state], ${wrapper} button[aria-expanded]`,
  );
  if (!button) return null;
  const rect = button.getBoundingClientRect();
  return {
    text: (button.textContent ?? "").replace(/\s+/g, " ").trim(),
    open:
      button.getAttribute("data-state") === "open" ||
      button.getAttribute("aria-expanded") === "true",
    point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
  };
}

/** The open mode menu's radio items, or null when the menu is not open. */
export function readModeMenuItems(): ModeMenuItem[] | null {
  const openModeMenu = (): Element | null => {
    const wrapper = '[data-testid="ask-input-mode-toggle-width-wrapper"]';
    const button = document.querySelector(
      `${wrapper} button[data-state], ${wrapper} button[aria-expanded]`,
    );
    const menuId = button?.getAttribute("aria-controls");
    const menu = menuId ? document.getElementById(menuId) : null;
    const isOpenMenu =
      menu?.getAttribute("role") === "menu" &&
      menu.getAttribute("data-state") !== "closed";
    return isOpenMenu ? menu : null;
  };

  const menu = openModeMenu();
  if (!menu) return null;
  return [...menu.querySelectorAll('[role="menuitemradio"]')].map((item) => ({
    label: (item.textContent ?? "").replace(/\s+/g, " ").trim(),
    checked: item.getAttribute("aria-checked") === "true",
  }));
}

/**
 * The centre of the open mode menu's radio item labelled exactly `label`,
 * or null when the menu is not open or holds no such item.
 */
export function locateModeMenuItem(label: string): PagePoint | null {
  const openModeMenu = (): Element | null => {
    const wrapper = '[data-testid="ask-input-mode-toggle-width-wrapper"]';
    const button = document.querySelector(
      `${wrapper} button[data-state], ${wrapper} button[aria-expanded]`,
    );
    const menuId = button?.getAttribute("aria-controls");
    const menu = menuId ? document.getElementById(menuId) : null;
    const isOpenMenu =
      menu?.getAttribute("role") === "menu" &&
      menu.getAttribute("data-state") !== "closed";
    return isOpenMenu ? menu : null;
  };
  const normalise = (text: string | null): string =>
    (text ?? "").replace(/\s+/g, " ").trim();

  const menu = openModeMenu();
  if (!menu) return null;
  const wanted = normalise(label);
  const item = [...menu.querySelectorAll('[role="menuitemradio"]')].find(
    (candidate) => normalise(candidate.textContent) === wanted,
  );
  if (!item) return null;
  const rect = item.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

// The input bar: as read from the live page on 2026-09-26, Perplexity's
// input bar is a Lexical editor, a contenteditable `div#ask-input` with
// role "textbox", on the home page and in a thread alike; a textarea on
// older pages. Its Submit button (`aria-label="Submit"`) sits a few levels
// up beside it, and shows only while the field holds text. The prompt
// never reaches these scripts: it is inserted through CDP once
// `selectAskInput` has focused the field.

/**
 * Focuses the input bar and selects everything in it, so the text inserted
 * next replaces whatever it held; false when the page has no input bar.
 */
export function selectAskInput(): boolean {
  const findAskInput = (): HTMLElement | null =>
    document.querySelector<HTMLElement>("#ask-input") ??
    document.querySelector<HTMLElement>(
      '[contenteditable="true"][role="textbox"]',
    ) ??
    document.querySelector<HTMLElement>("textarea");

  const input = findAskInput();
  if (!input) return false;
  input.focus();
  if (input instanceof HTMLTextAreaElement) input.select();
  else window.getSelection()?.selectAllChildren(input);
  return true;
}

/** The text the input bar holds, or null when the page has no input bar. */
export function readAskInput(): string | null {
  const findAskInput = (): HTMLElement | null =>
    document.querySelector<HTMLElement>("#ask-input") ??
    document.querySelector<HTMLElement>(
      '[contenteditable="true"][role="textbox"]',
    ) ??
    document.querySelector<HTMLElement>("textarea");

  const input = findAskInput();
  if (!input) return null;
  return input instanceof HTMLTextAreaElement ? input.value : input.innerText;
}

/**
 * The centre of the input bar's enabled Submit button, looked for a few
 * levels up from the input bar, or null when there is none.
 */
export function locateSubmitButton(): PagePoint | null {
  const findAskInput = (): HTMLElement | null =>
    document.querySelector<HTMLElement>("#ask-input") ??
    document.querySelector<HTMLElement>(
      '[contenteditable="true"][role="textbox"]',
    ) ??
    document.querySelector<HTMLElement>("textarea");
  const levelsUp = 6;

  let container = findAskInput()?.parentElement ?? null;
  for (let level = 0; container && level < levelsUp; level++) {
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Submit"]',
    );
    if (button) {
      if (button.disabled) return null;
      const rect = button.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    container = container.parentElement;
  }
  return null;
}

// The stop control: while Perplexity answers, the input bar shows a button
// labelled "Stop response (Esc)" where the Submit button sits (Perplexity's
// input bar script, as the page loaded it on 2026-09-26). Its filled stop
// icon is shared by the input bar's "Stop dictation" button and by the
// answer's read-aloud "Stop", so the label decides, compared exactly and in
// English, as the mode menu's labels are. `extractAgentStatus` finds it with
// the same search, written inside it; it also reads that icon under any
// other label but `Stop dictation`, near the input bar, as an answer in
// progress, since a page in another language translates the label. Only a
// click needs the exact control.

/**
 * The centre of the input bar's stop control, looked for a few levels up
 * from the input bar, or null when the input bar shows none.
 */
export function locateStopControl(): PagePoint | null {
  const findStopControl = (): HTMLButtonElement | null => {
    const stopLabel = "Stop response (Esc)";
    const levelsUp = 6;
    const askInput =
      document.querySelector<HTMLElement>("#ask-input") ??
      document.querySelector<HTMLElement>(
        '[contenteditable="true"][role="textbox"]',
      ) ??
      document.querySelector<HTMLElement>("textarea");
    let container = askInput?.parentElement ?? null;
    for (let level = 0; container && level < levelsUp; level++) {
      const stop = [
        ...container.querySelectorAll<HTMLButtonElement>("button[aria-label]"),
      ].find(
        (button) =>
          (button.getAttribute("aria-label") ?? "")
            .replace(/\s+/g, " ")
            .trim() === stopLabel,
      );
      if (stop) return stop;
      container = container.parentElement;
    }
    return null;
  };

  const stop = findStopControl();
  if (!stop) return null;
  const rect = stop.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}
