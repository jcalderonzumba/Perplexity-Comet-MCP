// The state of the ask in flight, and of the last one: which task it is,
// the prompt it was sent, the steps seen, and its answer once complete.
// Each ask core holds one, so each adapter keeps its own and tests start
// from a fresh one.

import { randomUUID } from "node:crypto";

/** A task with no activity for this long is no longer followed. */
export const TASK_STALE_AFTER_MS = 5 * 60 * 1000;

/** A task id: its start time, then a random UUID, unique within a millisecond. */
export function generateTaskId(nowMs: number): string {
  return `task_${nowMs}_${randomUUID()}`;
}

export class AskTaskState {
  currentTaskId: string | null = null;
  taskStartTime: number | null = null;
  lastPrompt: string | null = null;
  lastResponse: string | null = null;
  lastResponseTime: number | null = null;
  steps: string[] = [];
  isActive = false;
  /** The task ended before its prompt reached Comet. */
  promptNeverSent = false;

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Starts a task for `prompt`, forgetting the last one; returns its id. */
  start(prompt: string): string {
    const startedAt = this.now();
    const taskId = generateTaskId(startedAt);
    this.currentTaskId = taskId;
    this.taskStartTime = startedAt;
    this.lastPrompt = prompt;
    this.lastResponse = null;
    this.lastResponseTime = null;
    this.steps = [];
    this.isActive = true;
    this.promptNeverSent = false;
    return taskId;
  }

  /** Ends the task with its complete answer. */
  complete(response: string): void {
    this.lastResponse = response;
    this.lastResponseTime = this.now();
    this.isActive = false;
  }

  /** Ends a task whose prompt never reached Comet: it has no answer. */
  abandon(): void {
    this.isActive = false;
    this.promptNeverSent = true;
  }

  /** True with no task, or once the task started too long ago to follow. */
  isStale(): boolean {
    if (this.taskStartTime === null) return true;
    return this.now() - this.taskStartTime > TASK_STALE_AFTER_MS;
  }
}
