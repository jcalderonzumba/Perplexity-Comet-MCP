// The mode core: reads, switches and remembers Perplexity's mode through
// a small page port, for every adapter alike.
//
// It switches honestly: it opens the mode menu with pointer clicks, selects
// the item the catalogue names, then reopens the menu to read the checked
// item back, and reports success only when the page shows the mode asked
// for. Every wait is bounded, and every path that opened the menu closes it.
// A switch runs with the page's focus emulated, so its clicks and Escape
// reach a tab whose window is behind others, which the browser otherwise
// drops them for; emulation ends with the switch, whatever it does.
// Failures are data naming what the page showed; the adapter words and
// wraps them (`describeModeFailure`), since page text is untrusted.

import { errorMessage } from "../error-message.js";
import {
  isToolMode,
  MODE_CATALOGUE,
  TOOL_MODES,
  type ToolMode,
  toolModeForPageLabel,
} from "../modes.js";
import {
  locateModeButton,
  locateModeMenuItem,
  type ModeButton,
  type ModeMenuItem,
  type PageArgument,
  type PagePoint,
  readModeMenuItems,
} from "../page-scripts.js";

/** What the mode core needs from the page; each adapter supplies one. */
export interface ModePage {
  /** Runs a page script with its arguments, serialised, and returns its value. */
  run<A extends PageArgument[], R>(
    script: (...args: A) => R,
    ...args: A
  ): Promise<R>;
  /** Clicks at a viewport point with real pointer events. */
  clickAt(point: PagePoint): Promise<void>;
  pressEscape(): Promise<void>;
  wait(ms: number): Promise<void>;
  /**
   * Makes the tab take trusted input as if its window were focused, until
   * `stopFocusEmulation`; refused off Perplexity.
   */
  startFocusEmulation(): Promise<void>;
  stopFocusEmulation(): Promise<void>;
}

/**
 * The bounds on every wait, in milliseconds. A bound counts the time spent
 * in `ModePage.wait`, not the time the page scripts themselves take.
 */
export const MODE_TIMING = {
  /** Between two reads of the page while waiting for it. */
  pollMs: 100,
  /** For the mode button to appear, as after a navigation. */
  pageReadyMs: 10_000,
  /**
   * Before each click on the mode button: the live page closes a menu
   * opened within about 300 ms of its last close.
   */
  settleMs: 400,
  /** For the menu to open after a click on the button. */
  menuOpenMs: 1_500,
  /** For the button to name the mode just selected. */
  readBackMs: 2_000,
  /** For the menu to close after Escape. */
  menuCloseMs: 1_000,
} as const;

/** Why the mode could not be switched, with what the page showed. */
export type ModeFailure =
  | { kind: "invalid-mode"; input: string }
  | { kind: "not-selectable"; mode: ToolMode; reason: string }
  | { kind: "no-button"; mode: ToolMode }
  | { kind: "menu-did-not-open"; mode: ToolMode; buttonText: string }
  | {
      kind: "item-missing";
      mode: ToolMode;
      label: string;
      labelsPresent: string[];
    }
  | {
      kind: "read-back-mismatch";
      mode: ToolMode;
      label: string;
      checkedLabel: string | null;
      buttonText: string;
    }
  | { kind: "menu-left-open"; mode: ToolMode }
  | { kind: "page-error"; mode: ToolMode; message: string }
  /** `message` is the server's own refusal, not page text. */
  | { kind: "focus-not-emulated"; mode: ToolMode; message: string };

export type SwitchResult =
  | { ok: true; mode: ToolMode }
  | { ok: false; failure: ModeFailure };

/**
 * The mode the page's button shows. A page error's message is page text,
 * like the button's.
 */
export type ModeReading =
  | { kind: "known"; mode: ToolMode }
  | { kind: "unknown"; text: string }
  | { kind: "no-button" }
  | { kind: "page-error"; message: string };

export type EnsureOutcome =
  | { status: "no-mode" }
  | { status: "already-set"; mode: ToolMode }
  | { status: "applied"; mode: ToolMode }
  | { status: "failed"; mode: ToolMode; failure: ModeFailure };

/**
 * A failure in words. `quotePage` receives every piece of text read from
 * the page, and only those, so the adapter can wrap them as untrusted.
 */
export function describeModeFailure(
  failure: ModeFailure,
  quotePage: (pageText: string) => string,
): string {
  if (failure.kind === "invalid-mode") {
    return `Invalid mode: ${failure.input}. Use: ${TOOL_MODES.join(", ")}`;
  }
  return `Cannot switch to ${failure.mode} mode: ${failureDetail(failure, quotePage)}`;
}

function failureDetail(
  failure: Exclude<ModeFailure, { kind: "invalid-mode" }>,
  quotePage: (pageText: string) => string,
): string {
  switch (failure.kind) {
    case "not-selectable":
      return failure.reason;
    case "no-button":
      return "no mode button found on the page";
    case "menu-did-not-open":
      return `the mode menu did not open (the mode button reads ${quotePage(failure.buttonText)})`;
    case "item-missing":
      return `the mode menu has no "${failure.label}" item (items present: ${quotePage(failure.labelsPresent.join(", "))})`;
    case "read-back-mismatch": {
      const checked =
        failure.checkedLabel === null
          ? "no item"
          : quotePage(failure.checkedLabel);
      return `after selecting "${failure.label}" the menu has ${checked} checked and the mode button reads ${quotePage(failure.buttonText)}`;
    }
    case "menu-left-open":
      return "the mode menu did not close";
    case "page-error":
      return `the page failed: ${quotePage(failure.message)}`;
    case "focus-not-emulated":
      return `the page's focus could not be emulated, so its clicks would not be taken (${failure.message})`;
  }
}

/** A failure raised inside a switch, carried out to `switchMode`. */
class SwitchFailed extends Error {
  constructor(readonly failure: ModeFailure) {
    super(failure.kind);
  }
}

/**
 * Reads, switches and remembers the mode. Each adapter creates one over its
 * page port when it starts, so the remembered mode lives as long as the
 * server and belongs to it alone.
 */
export class ModeCore {
  private remembered: ToolMode | undefined;

  constructor(private readonly page: ModePage) {}

  /** The mode the last successful switch set, if any. */
  get rememberedMode(): ToolMode | undefined {
    return this.remembered;
  }

  /**
   * The mode the button shows, read without opening the menu, once the
   * button appears within the bounded wait. A page error is a reading, not
   * a throw, so its message reaches the adapter as page text.
   */
  async readMode(): Promise<ModeReading> {
    let button: ModeButton | null;
    try {
      button = await this.waitForButton();
    } catch (error) {
      return { kind: "page-error", message: errorMessage(error) };
    }
    if (!button) return { kind: "no-button" };
    const mode = toolModeForPageLabel(button.text);
    return mode
      ? { kind: "known", mode }
      : { kind: "unknown", text: button.text };
  }

  /**
   * Switches the page to `mode`, validated here before any page call, and
   * remembers it when the page shows it afterwards.
   */
  async switchMode(mode: unknown): Promise<SwitchResult> {
    if (!isToolMode(mode)) {
      return fail({ kind: "invalid-mode", input: String(mode) });
    }
    const entry = MODE_CATALOGUE[mode];
    if (!entry.selectable) {
      return fail({ kind: "not-selectable", mode, reason: entry.reason });
    }
    const result = await this.selectOnPage(mode, entry.pageLabel);
    if (result.ok) this.remembered = mode;
    return result;
  }

  /**
   * Puts the page back in the remembered mode when it has lost it, as a
   * navigation does. Does nothing when no mode is remembered.
   */
  async ensureMode(): Promise<EnsureOutcome> {
    const mode = this.remembered;
    if (!mode) return { status: "no-mode" };
    const reading = await this.readMode();
    if (reading.kind === "no-button") {
      return { status: "failed", mode, failure: { kind: "no-button", mode } };
    }
    if (reading.kind === "page-error") {
      const failure: ModeFailure = {
        kind: "page-error",
        mode,
        message: reading.message,
      };
      return { status: "failed", mode, failure };
    }
    if (reading.kind === "known" && reading.mode === mode) {
      return { status: "already-set", mode };
    }
    const result = await this.switchMode(mode);
    return result.ok
      ? { status: "applied", mode }
      : { status: "failed", mode, failure: result.failure };
  }

  /**
   * Selects on the page with its focus emulated, and stops emulating it
   * whatever the selection does. Failing to stop never replaces the
   * selection's own result: a connection too broken to stop it has ended
   * the emulation with it.
   */
  private async selectOnPage(
    mode: ToolMode,
    label: string,
  ): Promise<SwitchResult> {
    try {
      await this.page.startFocusEmulation();
    } catch (error) {
      return fail({
        kind: "focus-not-emulated",
        mode,
        message: errorMessage(error),
      });
    }
    try {
      return await this.selectAndClose(mode, label);
    } finally {
      await this.page.stopFocusEmulation().catch(() => undefined);
    }
  }

  private async selectAndClose(
    mode: ToolMode,
    label: string,
  ): Promise<SwitchResult> {
    let failure: ModeFailure | undefined;
    try {
      await this.selectAndReadBack(mode, label);
    } catch (error) {
      failure =
        error instanceof SwitchFailed ? error.failure : pageError(mode, error);
    }
    const closed = await this.closeMenu();
    if (!failure && !closed) failure = { kind: "menu-left-open", mode };
    return failure ? fail(failure) : { ok: true, mode };
  }

  private async selectAndReadBack(
    mode: ToolMode,
    label: string,
  ): Promise<void> {
    const items = await this.openMenu(mode);
    const itemPoint = await this.page.run(locateModeMenuItem, label);
    if (!itemPoint) {
      throw new SwitchFailed({
        kind: "item-missing",
        mode,
        label,
        labelsPresent: items.map((item) => item.label),
      });
    }
    await this.page.clickAt(itemPoint);
    const buttonText = await this.waitForButtonText(label);
    const checkedLabel = checkedLabelOf(await this.openMenu(mode));
    if (checkedLabel !== label || buttonText !== label) {
      throw new SwitchFailed({
        kind: "read-back-mismatch",
        mode,
        label,
        checkedLabel,
        buttonText,
      });
    }
  }

  /**
   * Opens the mode menu, or finds it open, and returns its items. A click
   * the page ignores is retried once.
   */
  private async openMenu(mode: ToolMode): Promise<ModeMenuItem[]> {
    const button = await this.waitForButton();
    if (!button) throw new SwitchFailed({ kind: "no-button", mode });
    let seen = button;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!seen.open) {
        await this.page.wait(MODE_TIMING.settleMs);
        await this.page.clickAt(seen.point);
      }
      const items = await this.waitForMenuItems();
      if (items) return items;
      seen = (await this.page.run(locateModeButton)) ?? seen;
    }
    throw new SwitchFailed({
      kind: "menu-did-not-open",
      mode,
      buttonText: seen.text,
    });
  }

  /** Closes the menu if it is open; false when it stays open. */
  private async closeMenu(): Promise<boolean> {
    try {
      if (!(await this.isMenuOpen())) return true;
      await this.page.pressEscape();
      const closed = await this.poll(
        async () => ((await this.isMenuOpen()) ? null : true),
        MODE_TIMING.menuCloseMs,
      );
      return closed ?? false;
    } catch {
      return false;
    }
  }

  private async isMenuOpen(): Promise<boolean> {
    const button = await this.page.run(locateModeButton);
    const items = await this.page.run(readModeMenuItems);
    return Boolean(button?.open) || items !== null;
  }

  private waitForButton(): Promise<ModeButton | null> {
    return this.poll(
      () => this.page.run(locateModeButton),
      MODE_TIMING.pageReadyMs,
    );
  }

  private waitForMenuItems(): Promise<ModeMenuItem[] | null> {
    return this.poll(
      () => this.page.run(readModeMenuItems),
      MODE_TIMING.menuOpenMs,
    );
  }

  /** The button's text once it reads `label`, or as it reads at the bound. */
  private async waitForButtonText(label: string): Promise<string> {
    const named = await this.poll(async () => {
      const button = await this.page.run(locateModeButton);
      return button?.text === label ? button.text : null;
    }, MODE_TIMING.readBackMs);
    if (named) return named;
    return (await this.page.run(locateModeButton))?.text ?? "";
  }

  /** Reads until `read` returns a value, for at most `budgetMs` of waiting. */
  private async poll<T>(
    read: () => Promise<T | null>,
    budgetMs: number,
  ): Promise<T | null> {
    for (let waited = 0; ; waited += MODE_TIMING.pollMs) {
      const value = await read();
      if (value !== null) return value;
      if (waited >= budgetMs) return null;
      await this.page.wait(MODE_TIMING.pollMs);
    }
  }
}

function fail(failure: ModeFailure): SwitchResult {
  return { ok: false, failure };
}

function pageError(mode: ToolMode, error: unknown): ModeFailure {
  return { kind: "page-error", mode, message: errorMessage(error) };
}

function checkedLabelOf(items: ModeMenuItem[]): string | null {
  return items.find((item) => item.checked)?.label ?? null;
}
