// The state of the ask in flight, and of the last one: which task it is,
// the prompt it was sent, the steps seen, where it stands, and its answer
// once complete. It changes only through its methods, so a task that was
// stopped or replaced can never be completed afterwards.
// Each ask core holds one, so each adapter keeps its own and tests start
// from a fresh one.

import { randomUUID } from "node:crypto";

/** A task with no activity for this long is no longer followed. */
export const TASK_STALE_AFTER_MS = 5 * 60 * 1000;

/** A task id: its start time, then a random UUID, unique within a millisecond. */
export function generateTaskId(nowMs: number): string {
  return `task_${nowMs}_${randomUUID()}`;
}

/**
 * Where the task is: none started yet, followed, ended with its answer,
 * stopped, or ended before its prompt reached Comet.
 */
export type TaskState =
  | "none"
  | "active"
  | "completed"
  | "stopped"
  | "not-sent";

export class AskTaskState {
  private taskState: TaskState = "none";
  private taskId: string | null = null;
  private startedAt: number | null = null;
  private prompt: string | null = null;
  private response: string | null = null;
  private responseTime: number | null = null;
  private seenSteps: readonly string[] = [];

  constructor(private readonly now: () => number = () => Date.now()) {}

  get state(): TaskState {
    return this.taskState;
  }

  get isActive(): boolean {
    return this.taskState === "active";
  }

  get currentTaskId(): string | null {
    return this.taskId;
  }

  get taskStartTime(): number | null {
    return this.startedAt;
  }

  get lastPrompt(): string | null {
    return this.prompt;
  }

  /** The answer of a completed task, or null. */
  get lastResponse(): string | null {
    return this.response;
  }

  get lastResponseTime(): number | null {
    return this.responseTime;
  }

  get steps(): readonly string[] {
    return this.seenSteps;
  }

  /** Starts a task for `prompt`, forgetting the last one; returns its id. */
  start(prompt: string): string {
    const startedAt = this.now();
    this.taskId = generateTaskId(startedAt);
    this.startedAt = startedAt;
    this.prompt = prompt;
    this.response = null;
    this.responseTime = null;
    this.seenSteps = [];
    this.taskState = "active";
    return this.taskId;
  }

  /** Whether `taskId` is the task followed now. */
  isFollowing(taskId: string | null): boolean {
    return this.isActive && taskId !== null && taskId === this.taskId;
  }

  recordSteps(steps: readonly string[]): void {
    this.seenSteps = [...steps];
  }

  /**
   * Ends the task `taskId` with its complete answer; false, and nothing
   * changed, when that task is no longer followed: stopped, or replaced.
   */
  complete(taskId: string | null, response: string): boolean {
    if (!this.isFollowing(taskId)) return false;
    this.response = response;
    this.responseTime = this.now();
    this.taskState = "completed";
    return true;
  }

  /** Ends the task followed now without an answer: it was stopped. */
  stop(): void {
    if (this.isActive) this.taskState = "stopped";
  }

  /** Ends the task `taskId`, when followed: its prompt never reached Comet. */
  abandon(taskId: string | null): void {
    if (this.isFollowing(taskId)) this.taskState = "not-sent";
  }

  /** True with no task, or once the task started too long ago to follow. */
  isStale(): boolean {
    if (this.startedAt === null) return true;
    return this.now() - this.startedAt > TASK_STALE_AFTER_MS;
  }
}
