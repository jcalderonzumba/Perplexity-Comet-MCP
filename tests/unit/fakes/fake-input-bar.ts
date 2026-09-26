// A fake of Perplexity's input bar, as the send step drives it through the
// ask port: selected by a page script, typed into by trusted text, and
// submitted by a trusted Enter or a click on its Submit button.
//
// By default it behaves like the live page with the window in front: the
// text inserted after a selection replaces the field, and Enter submits a
// field that holds text, emptying it. Each knob turns one step off, as a
// page that does not take it would. Every call is logged by name in `log`.

import type { PagePoint } from "../../../src/page-scripts.js";

export const SUBMIT_BUTTON: PagePoint = { x: 640, y: 480 };

export class FakeInputBar {
  /** Every input-bar call by name, oldest first. */
  public readonly log: string[] = [];
  /** Every text the trusted insertion was given, whether or not it took. */
  public readonly inserted: string[] = [];
  /** Every prompt the page took as submitted. */
  public readonly submitted: string[] = [];
  public readonly clicks: PagePoint[] = [];

  /** Whether the page shows an input bar at all. */
  public present = true;
  /** What the field holds. */
  public text = "";
  /** Whether inserted text lands in the field. */
  public takesText = true;
  /** Whether a trusted Enter submits. */
  public takesEnter = true;
  /** Whether a click on the Submit button submits. */
  public takesClick = true;
  /** Whether the page shows a Submit button while the field holds text. */
  public hasSubmitButton = true;
  /** When set, the trusted input the origin gate refuses, with this error. */
  public inputRefusal: Error | null = null;
  /** Runs when the page takes a prompt as submitted. */
  public onSubmit: ((prompt: string) => void) | undefined;

  private selected = false;

  async selectAskInput(): Promise<boolean> {
    this.log.push("selectAskInput");
    this.selected = this.present;
    return this.present;
  }

  async readAskInput(): Promise<string | null> {
    this.log.push("readAskInput");
    return this.present ? this.text : null;
  }

  async insertText(text: string): Promise<void> {
    this.log.push("insertText");
    this.refuseIfSet();
    this.inserted.push(text);
    if (this.takesText && this.selected) this.text = text;
  }

  async pressEnter(): Promise<void> {
    this.log.push("pressEnter");
    this.refuseIfSet();
    if (this.takesEnter) this.submit();
  }

  async locateSubmitButton(): Promise<PagePoint | null> {
    this.log.push("locateSubmitButton");
    const shown = this.present && this.hasSubmitButton && this.text !== "";
    return shown ? SUBMIT_BUTTON : null;
  }

  async clickAt(point: PagePoint): Promise<void> {
    this.log.push("clickAt");
    this.refuseIfSet();
    this.clicks.push(point);
    if (this.takesClick) this.submit();
  }

  private submit(): void {
    if (this.text === "") return;
    const prompt = this.text;
    this.text = "";
    this.submitted.push(prompt);
    this.onSubmit?.(prompt);
  }

  private refuseIfSet(): void {
    if (this.inputRefusal) throw this.inputRefusal;
  }
}
