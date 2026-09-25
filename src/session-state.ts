// The stdio server's task state, one `AskTaskState` for the whole process,
// behind the functions its handlers call. The ask core holds a task state of
// its own; this module goes once the handlers use the core's.

import { cometAI } from "./comet-ai.js";
import { AskTaskState, generateTaskId as taskIdAt } from "./core/ask-task.js";

export interface SessionState {
  currentTaskId: string | null;
  taskStartTime: number | null;
  lastPrompt: string | null;
  lastResponse: string | null;
  lastResponseTime: number | null;
  steps: string[];
  isActive: boolean;
}

const task = new AskTaskState();

export const sessionState: SessionState = task;

export function generateTaskId(): string {
  return taskIdAt(Date.now());
}

export function startNewTask(prompt: string): string {
  const taskId = task.start(prompt);
  cometAI.resetStabilityTracking();
  return taskId;
}

export function completeTask(response: string): void {
  task.complete(response);
}

export function isSessionStale(): boolean {
  return task.isStale();
}
