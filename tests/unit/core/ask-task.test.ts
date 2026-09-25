import { describe, expect, it } from "vitest";
import {
  AskTaskState,
  generateTaskId,
  TASK_STALE_AFTER_MS,
} from "../../../src/core/ask-task.js";

/** A clock the test moves by hand. */
function manualClock(startMs = 1_000_000) {
  let nowMs = startMs;
  return {
    now: () => nowMs,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

const TASK_ID =
  /^task_\d+_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("generateTaskId", () => {
  it("returns task_<unix-ms>_<uuid>", () => {
    expect(generateTaskId(1234)).toMatch(/^task_1234_/);
    expect(generateTaskId(1234)).toMatch(TASK_ID);
  });

  it("returns unique ids within the same millisecond", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateTaskId(1)));
    expect(ids.size).toBe(100);
  });
});

describe("AskTaskState", () => {
  it("starts with no task", () => {
    const task = new AskTaskState(manualClock().now);

    expect(task.currentTaskId).toBeNull();
    expect(task.isActive).toBe(false);
    expect(task.steps).toEqual([]);
  });

  it("starts a task: active, with its prompt and start time", () => {
    const clock = manualClock();
    const task = new AskTaskState(clock.now);

    const id = task.start("hello");

    expect(id).toMatch(TASK_ID);
    expect(task.currentTaskId).toBe(id);
    expect(task.lastPrompt).toBe("hello");
    expect(task.isActive).toBe(true);
    expect(task.taskStartTime).toBe(clock.now());
  });

  it("forgets the previous task's answer and steps when a new one starts", () => {
    const task = new AskTaskState(manualClock().now);
    task.start("first");
    task.steps = ["old step"];
    task.complete("first answer");

    task.start("second");

    expect(task.lastResponse).toBeNull();
    expect(task.lastResponseTime).toBeNull();
    expect(task.steps).toEqual([]);
  });

  it("completes a task: its answer kept, stamped, no longer active", () => {
    const clock = manualClock();
    const task = new AskTaskState(clock.now);
    task.start("a prompt");
    clock.advance(4000);

    task.complete("the answer");

    expect(task.lastResponse).toBe("the answer");
    expect(task.lastResponseTime).toBe(clock.now());
    expect(task.isActive).toBe(false);
  });

  it("is stale with no task, and five minutes after the task started", () => {
    const clock = manualClock();
    const task = new AskTaskState(clock.now);
    expect(task.isStale()).toBe(true);

    task.start("a prompt");
    clock.advance(TASK_STALE_AFTER_MS - 1000);
    expect(task.isStale()).toBe(false);

    clock.advance(2000);
    expect(task.isStale()).toBe(true);
  });

  it("belongs to its own instance", () => {
    const one = new AskTaskState(manualClock().now);
    const other = new AskTaskState(manualClock().now);

    one.start("mine");

    expect(other.currentTaskId).toBeNull();
    expect(other.isActive).toBe(false);
  });
});
