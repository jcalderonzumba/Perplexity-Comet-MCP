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

export interface ProseState {
  count: number;
  lastText: string;
}

export function readProseState(): ProseState {
  const proseEls = document.querySelectorAll('[class*="prose"]');
  const lastProse = proseEls[proseEls.length - 1] as HTMLElement | undefined;
  return {
    count: proseEls.length,
    lastText: lastProse ? lastProse.innerText.substring(0, 100) : "",
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

  // Check for active stop button (more comprehensive check)
  let hasActiveStopButton = false;
  for (const btn of document.querySelectorAll("button")) {
    const rect = btn.querySelector("rect");
    const ariaLabel = (btn.getAttribute("aria-label") || "").toLowerCase();
    const btnText = btn.innerText.toLowerCase();

    // Stop button indicators: square icon (rect), "stop" label, or specific SVG patterns
    const isStopButton =
      rect ||
      ariaLabel.includes("stop") ||
      ariaLabel.includes("cancel") ||
      btnText === "stop";

    if (
      isStopButton &&
      (btn as HTMLButtonElement).offsetParent !== null &&
      !(btn as HTMLButtonElement).disabled
    ) {
      hasActiveStopButton = true;
      break;
    }
  }

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
  // miss completion on non-English accounts and force fallback to slow
  // response-stability polling (~90s). See PR #9 notes for marker source.
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

  // Check for prose content (actual response) - lowered threshold for short answers
  const proseEls = [
    ...document.querySelectorAll('[class*="prose"]'),
  ] as HTMLElement[];
  const hasProseContent = proseEls.some((el) => {
    const text = el.innerText.trim();
    // Must have some content, not just UI text (lowered from 50 to 15 for short answers)
    return (
      text.length > 15 &&
      !text.startsWith("Library") &&
      !text.startsWith("Discover")
    );
  });

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
  if (hasActiveStopButton) {
    status = "working";
  } else if (hasLoadingSpinner || hasThinkingIndicator) {
    status = "working";
  }
  // SECOND: Check completion indicators BEFORE working text
  // (because completed pages still show historical step text)
  else if (hasStepsCompleted || hasFinishedMarker) {
    status = "completed";
  } else if (hasAskFollowUp && hasProseContent) {
    status = "completed";
  } else if (hasSourcesIndicator && hasProseContent && !hasActiveStopButton) {
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

  // Extract response - get the FULL FINAL response after agent completes
  let response = "";
  if (status === "completed") {
    const mainContent = (document.querySelector("main") ||
      document.body) as HTMLElement;
    const bodyText = mainContent.innerText;

    // Strategy 1: Find content after "X steps completed" marker (agent's final response).
    // In multi-turn chats Perplexity keeps previous-turn markers in the
    // scroll buffer, and the marker text differs across turns ("3 steps
    // completed" vs "5 steps completed"). `match()` returns only the
    // FIRST match, so anchoring on it — with either `indexOf` or
    // `lastIndexOf` of that exact string — lands on the OLDEST turn.
    // Walk every match with the /g flag and take the last one.
    const stepsMatches = [...bodyText.matchAll(/(\d+)\s*steps?\s*completed/gi)];
    const stepsMatch =
      stepsMatches.length > 0 ? stepsMatches[stepsMatches.length - 1] : null;
    if (stepsMatch) {
      const markerIndex = stepsMatch.index ?? -1;
      if (markerIndex !== -1) {
        // Get everything after the marker
        let afterMarker = bodyText
          .substring(markerIndex + stepsMatch[0].length)
          .trim();

        // Remove the ">" or arrow that often follows
        afterMarker = afterMarker.replace(/^[>›→\s]+/, "").trim();

        // Find where the response ends (before input area or UI elements)
        const endMarkers = [
          "Ask anything",
          "Ask a follow-up",
          "Add details",
          "Type a message",
          "Задайте уточняющий вопрос",
          "Последующие вопросы", // ru
        ];
        let endIndex = afterMarker.length;
        for (const marker of endMarkers) {
          const idx = afterMarker.indexOf(marker);
          if (idx !== -1 && idx < endIndex) {
            endIndex = idx;
          }
        }

        response = afterMarker.substring(0, endIndex).trim();
      }
    }

    // Strategy 2: If no steps marker, look for content after source citations
    if (!response || response.length < 50) {
      // Same rationale as Strategy 1: walk every match and take the last.
      const sourcesMatches = [
        ...bodyText.matchAll(/Reviewed\s+\d+\s+sources?/gi),
      ];
      const sourcesMatch =
        sourcesMatches.length > 0
          ? sourcesMatches[sourcesMatches.length - 1]
          : null;
      if (sourcesMatch) {
        const markerIndex = sourcesMatch.index ?? -1;
        if (markerIndex !== -1) {
          const afterMarker = bodyText
            .substring(markerIndex + sourcesMatch[0].length)
            .trim();
          const endMarkers = [
            "Ask anything",
            "Ask a follow-up",
            "Add details",
            "Задайте уточняющий вопрос",
            "Последующие вопросы", // ru
          ];
          let endIndex = afterMarker.length;
          for (const marker of endMarkers) {
            const idx = afterMarker.indexOf(marker);
            if (idx !== -1 && idx < endIndex) endIndex = idx;
          }
          response = afterMarker.substring(0, endIndex).trim();
        }
      }
    }

    // Strategy 3: Fallback - get all prose content combined
    if (!response || response.length < 50) {
      const allProseEls = [
        ...mainContent.querySelectorAll('[class*="prose"]'),
      ] as HTMLElement[];
      const validTexts = allProseEls
        .filter((el) => {
          if (el.closest("nav, aside, header, footer, form, [contenteditable]"))
            return false;
          const text = el.innerText.trim();
          const isUIText = [
            "Library",
            "Discover",
            "Spaces",
            "Finance",
            "Account",
            "Upgrade",
            "Home",
            "Search",
          ].some((ui) => text.startsWith(ui));
          return !isUIText && text.length > 30;
        })
        .map((el) => el.innerText.trim());

      // Combine all valid prose texts, taking the last/most recent ones
      if (validTexts.length > 0) {
        // Take last 3 prose blocks max (most recent response)
        response = validTexts.slice(-3).join("\n\n");
      }
    }

    // Clean up response - preserve formatting but remove UI artifacts
    if (response) {
      response = response
        .replace(/View All/gi, "")
        .replace(/Show more/gi, "")
        .replace(/Ask a follow-up/gi, "")
        .replace(/Ask anything\.*/gi, "")
        .replace(/Add details to this task\.*/gi, "")
        .replace(/Задайте уточняющий вопрос/giu, "") // ru
        .replace(/Последующие вопросы/giu, "") // ru
        .replace(/\d+\s*sources?\s*$/gi, "")
        .replace(/\d+\s*источник(?:а|ов)?\s*$/giu, "") // ru
        .replace(/[\u{1F300}-\u{1F9FF}]/gu, "") // Remove most emojis from UI
        .replace(/^[>›→\s]+/gm, "") // Remove leading arrows
        .replace(/\n{3,}/g, "\n\n") // Collapse multiple newlines
        .trim();
    }
  }

  return {
    status,
    steps: [...new Set(steps)].slice(-5),
    currentStep: steps.length > 0 ? steps[steps.length - 1] : "",
    response: response.substring(0, 8000),
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
