// A fake of the page port `ModeCore` drives: a model of Perplexity's mode
// button and mode menu, answering the three mode page scripts by identity
// and taking clicks at the points it hands out.
//
// Its defaults follow the live page as read on 2026-09-24: the button shows
// the current mode; clicking it opens the menu, unless the menu closed less
// than `RECLOSE_WINDOW_MS` before, in which case the page closes it again at
// once; selecting an item checks it, renames the button and closes the menu;
// Escape closes the menu. Time only passes through `wait`.

import type { ModePage } from "../../../src/core/mode.js";
import {
  locateModeButton,
  locateModeMenuItem,
  type ModeButton,
  type ModeMenuItem,
  type PageArgument,
  type PagePoint,
  readModeMenuItems,
} from "../../../src/page-scripts.js";

export const BUTTON_POINT: PagePoint = { x: 600, y: 380 };
const NOWHERE = "nowhere";
const RECLOSE_WINDOW_MS = 300;

export interface FakeModePageOptions {
  /** The labels of the menu's radio items, in order. */
  labels?: string[];
  /** The label checked, and shown on the button, at the start. */
  current?: string;
  /** False when the page shows no mode button at all. */
  hasButton?: boolean;
  /** Virtual milliseconds of `wait` before the button appears. */
  buttonAppearsAfterMs?: number;
  /** Whether the menu is open at the start. */
  menuOpen?: boolean;
}

export class FakeModePage implements ModePage {
  /** What each click hit: "button", "item:<label>" or "nowhere". */
  public readonly clicks: string[] = [];
  /** The name of each script run, oldest first. */
  public readonly scriptsRun: string[] = [];
  /** The arguments of each script run, oldest first. */
  public readonly scriptArguments: PageArgument[][] = [];
  public escapes = 0;
  public waitedMs = 0;

  /** Clicks on the button that the page ignores before one opens the menu. */
  public ignoredButtonClicks = 0;
  /** When false, clicking an item closes the menu but changes nothing. */
  public selectionTakes = true;
  /** When false, a selection checks the item but leaves the button text. */
  public buttonFollowsSelection = true;
  /** When false, Escape leaves the menu open. */
  public escapeCloses = true;
  /** The script whose run throws, as a CDP error would. */
  public failingScript: string | undefined;
  /** The message that run throws with; by default it names the script. */
  public failureMessage: string | undefined;

  private labels: string[];
  private checkedLabel: string;
  private buttonText: string;
  private hasButton: boolean;
  private buttonAppearsAt: number;
  private menuOpen: boolean;
  private lastClosedAt = Number.NEGATIVE_INFINITY;

  constructor(options: FakeModePageOptions = {}) {
    this.labels = options.labels ?? [
      "Search",
      "Deep research",
      "Learn step by step",
    ];
    this.checkedLabel = options.current ?? "Search";
    this.buttonText = this.checkedLabel;
    this.hasButton = options.hasButton ?? true;
    this.buttonAppearsAt = options.buttonAppearsAfterMs ?? 0;
    this.menuOpen = options.menuOpen ?? false;
  }

  /** Whether the menu is open now. */
  get isMenuOpen(): boolean {
    return this.menuOpen;
  }

  /** The label the menu has checked now. */
  get checked(): string {
    return this.checkedLabel;
  }

  /** What a navigation does: the page back in `label`, the menu closed. */
  navigateTo(label: string): void {
    this.checkedLabel = label;
    this.buttonText = label;
    this.menuOpen = false;
  }

  /** What a navigation to a page without the input bar does. */
  removeButton(): void {
    this.hasButton = false;
    this.menuOpen = false;
  }

  async run<A extends PageArgument[], R>(
    script: (...args: A) => R,
    ...args: A
  ): Promise<R> {
    this.scriptsRun.push(script.name);
    this.scriptArguments.push(args);
    if (script.name === this.failingScript) {
      throw new Error(
        this.failureMessage ?? `Runtime.evaluate failed in ${script.name}`,
      );
    }
    return this.answer(script, args) as R;
  }

  async clickAt(point: PagePoint): Promise<void> {
    const target = this.targetAt(point);
    this.clicks.push(target);
    if (target === "button") this.clickButton();
    else if (target.startsWith("item:")) this.select(target.slice(5));
  }

  async pressEscape(): Promise<void> {
    this.escapes++;
    if (this.escapeCloses) this.close();
  }

  async wait(ms: number): Promise<void> {
    this.waitedMs += ms;
  }

  private answer(script: unknown, args: PageArgument[]): unknown {
    if (script === locateModeButton) return this.button();
    if (script === readModeMenuItems) return this.items();
    if (script === locateModeMenuItem) return this.itemPoint(String(args[0]));
    throw new Error("FakeModePage: unexpected page script");
  }

  private buttonShown(): boolean {
    return this.hasButton && this.waitedMs >= this.buttonAppearsAt;
  }

  private button(): ModeButton | null {
    if (!this.buttonShown()) return null;
    return { text: this.buttonText, open: this.menuOpen, point: BUTTON_POINT };
  }

  private items(): ModeMenuItem[] | null {
    if (!this.menuOpen) return null;
    return this.labels.map((label) => ({
      label,
      checked: label === this.checkedLabel,
    }));
  }

  private itemPoint(label: string): PagePoint | null {
    const index = this.labels.indexOf(label);
    if (!this.menuOpen || index < 0) return null;
    return { x: 650, y: 420 + 36 * index };
  }

  private targetAt(point: PagePoint): string {
    if (!this.buttonShown()) return NOWHERE;
    if (point.x === BUTTON_POINT.x && point.y === BUTTON_POINT.y) {
      return "button";
    }
    const label = this.labels.find((candidate) => {
      const itemPoint = this.itemPoint(candidate);
      return itemPoint?.x === point.x && itemPoint.y === point.y;
    });
    return label === undefined ? NOWHERE : `item:${label}`;
  }

  private clickButton(): void {
    if (this.menuOpen) {
      this.close();
      return;
    }
    const tooSoonAfterClose =
      this.waitedMs - this.lastClosedAt < RECLOSE_WINDOW_MS;
    if (tooSoonAfterClose) {
      this.lastClosedAt = this.waitedMs;
      return;
    }
    if (this.ignoredButtonClicks > 0) {
      this.ignoredButtonClicks--;
      return;
    }
    this.menuOpen = true;
  }

  private select(label: string): void {
    if (this.selectionTakes) {
      this.checkedLabel = label;
      if (this.buttonFollowsSelection) this.buttonText = label;
    }
    this.close();
  }

  private close(): void {
    this.menuOpen = false;
    this.lastClosedAt = this.waitedMs;
  }
}
