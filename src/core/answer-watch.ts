// When the ask's answer is complete: the page reads it completed, whatever
// its length, and it is the ask's own. In a thread the page's answer is
// always the latest turn's, so the answer is the ask's own once the page
// shows the turn whose question block holds the prompt, or a later one
// (`thread-turn.ts`), even when its text equals an earlier turn's. A page
// that shows no turn falls back to its prose and to the response it showed
// before.

import type { ThreadState } from "../page-scripts.js";
import type { AskStatus } from "./ask.js";
import { ownTurnAmong, questionProbe, showsOwnTurn } from "./thread-turn.js";

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
 * the turns whose question block holds the prompt (`markOwnTurn`), above the
 * read before sending as its floor, and until it is marked no answer is new.
 * On a page that shows no turn, new means a new prose block or text, and a
 * response that differs from the one on the page before.
 */
export class AnswerWatch {
  readonly steps: string[] = [];
  private sawNewTurn = false;
  private sawNewProse = false;
  /** The index of the ask's own turn, once the page shows its question. */
  private ownTurn: number | null = null;
  /** The start of the prompt the page is asked to find. */
  readonly question: string;

  constructor(
    /** The task whose answer this watch follows. */
    readonly taskId: string,
    private readonly before: PageBefore,
    /** The prompt as it was sent. */
    prompt: string,
  ) {
    this.question = questionProbe(prompt);
  }

  /**
   * Whether the page is still to be asked for the turn of the ask's own
   * question: not marked yet, and `thread` shows turns to mark it among.
   */
  awaitsOwnTurn(thread: ThreadState): boolean {
    return this.ownTurn === null && thread.latestTurn !== null;
  }

  /** Marks the own turn among the turns whose question block holds the prompt. */
  markOwnTurn(questionTurns: readonly number[]): void {
    this.ownTurn = ownTurnAmong(questionTurns, this.before.thread);
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
