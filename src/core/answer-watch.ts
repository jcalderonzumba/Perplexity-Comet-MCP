// When the ask's answer is complete: the page reads it completed, whatever
// its length, and it is the ask's own. In a thread the page's answer is
// always the latest turn's, so the answer is the ask's own once the page
// shows the turn marked at the confirmed submit, or a later one
// (`thread-turn.ts`), even when its text equals an earlier turn's. A page
// that shows no turn falls back to its prose and to the response it showed
// before.

import type { ThreadState } from "../page-scripts.js";
import type { AskStatus } from "./ask.js";
import { ownTurnFrom, showsOwnTurn } from "./thread-turn.js";

/** What was on the page before the prompt was sent. */
export interface PageBefore {
  readonly thread: ThreadState;
  readonly response: string;
}

/**
 * The completion rule, over the reads of one wait: the answer is complete
 * once the page reads it completed, whatever its length, and new. In a
 * thread, new means the page has shown the ask's own turn or a later one,
 * since the page's answer is the latest turn's; the own turn is marked from
 * the page as read once the submit was confirmed, with the read before
 * sending as its floor. On a page that shows no turn, new means a new prose
 * block or text, and a response that differs from the one on the page
 * before.
 */
export class AnswerWatch {
  readonly steps: string[] = [];
  private sawNewTurn = false;
  private sawNewProse = false;
  /** The index of the ask's own turn: the first the answer may come from. */
  private readonly ownTurn: number;

  constructor(
    /** The task whose answer this watch follows. */
    readonly taskId: string,
    private readonly before: PageBefore,
    /** The page's thread once the prompt's submit was confirmed. */
    atSubmit: ThreadState,
  ) {
    this.ownTurn = ownTurnFrom(before.thread, atSubmit);
  }

  observe(thread: ThreadState, status: AskStatus): void {
    const newTurn = showsOwnTurn(this.ownTurn, thread);
    if (newTurn) this.sawNewTurn = true;
    if (newTurn === undefined && this.showsNewProse(thread)) {
      this.sawNewProse = true;
    }
    for (const step of status.steps) {
      if (!this.steps.includes(step)) this.steps.push(step);
    }
  }

  isComplete(status: AskStatus): boolean {
    return status.status === "completed" && this.isNew(status.response);
  }

  /** The response when it is new, or empty when it is not. */
  newResponse(response: string): string {
    return this.isNew(response) ? response : "";
  }

  private isNew(response: string): boolean {
    if (response === "") return false;
    if (this.sawNewTurn) return true;
    return this.sawNewProse && response !== this.before.response;
  }

  private showsNewProse(thread: ThreadState): boolean {
    const { proseCount, lastProseText } = this.before.thread;
    return (
      thread.proseCount > proseCount ||
      (thread.lastProseText !== "" && thread.lastProseText !== lastProseText)
    );
  }
}
