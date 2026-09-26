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

    expect(task.state).toBe("none");
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
    expect(task.state).toBe("active");
    expect(task.isActive).toBe(true);
    expect(task.taskStartTime).toBe(clock.now());
  });

  it("records the steps seen, as a copy", () => {
    const task = new AskTaskState(manualClock().now);
    task.start("a prompt");
    const steps = ["Searching"];

    task.recordSteps(steps);
    steps.push("Reading");

    expect(task.steps).toEqual(["Searching"]);
  });

  it("forgets the previous task's answer and steps when a new one starts", () => {
    const task = new AskTaskState(manualClock().now);
    const first = task.start("first");
    task.recordSteps(["old step"]);
    task.complete(first, "first answer");

    task.start("second");

    expect(task.lastResponse).toBeNull();
    expect(task.lastResponseTime).toBeNull();
    expect(task.steps).toEqual([]);
  });

  it("completes a task: its answer kept, stamped, no longer active", () => {
    const clock = manualClock();
    const task = new AskTaskState(clock.now);
    const id = task.start("a prompt");
    clock.advance(4000);

    expect(task.complete(id, "the answer")).toBe(true);

    expect(task.state).toBe("completed");
    expect(task.lastResponse).toBe("the answer");
    expect(task.lastResponseTime).toBe(clock.now());
    expect(task.isActive).toBe(false);
  });

  it("stops a task: no answer, and no longer followed", () => {
    const task = new AskTaskState(manualClock().now);
    const id = task.start("a prompt");

    task.stop();

    expect(task.state).toBe("stopped");
    expect(task.isActive).toBe(false);
    expect(task.isFollowing(id)).toBe(false);
    expect(task.lastResponse).toBeNull();
  });

  it("never completes a task once it is stopped", () => {
    const task = new AskTaskState(manualClock().now);
    const id = task.start("a prompt");
    task.stop();

    expect(task.complete(id, "the stopped page's text")).toBe(false);

    expect(task.state).toBe("stopped");
    expect(task.lastResponse).toBeNull();
  });

  it("never completes a newer task with an older task's answer", () => {
    const task = new AskTaskState(manualClock().now);
    const older = task.start("first");
    const newer = task.start("second");

    expect(task.isFollowing(older)).toBe(false);
    expect(task.complete(older, "the first answer")).toBe(false);

    expect(task.isFollowing(newer)).toBe(true);
    expect(task.lastResponse).toBeNull();
  });

  it("never abandons a newer task for an older one's failure", () => {
    const task = new AskTaskState(manualClock().now);
    const older = task.start("first");
    task.start("second");

    task.abandon(older);

    expect(task.state).toBe("active");
  });

  it("leaves a completed task completed when stopped", () => {
    const task = new AskTaskState(manualClock().now);
    const id = task.start("a prompt");
    task.complete(id, "the answer");

    task.stop();

    expect(task.state).toBe("completed");
    expect(task.lastResponse).toBe("the answer");
  });

  it("abandons a task whose prompt was never sent: no answer, and no longer followed", () => {
    const clock = manualClock();
    const task = new AskTaskState(clock.now);
    const id = task.start("a prompt");

    task.abandon(id);

    expect(task.state).toBe("not-sent");
    expect(task.isActive).toBe(false);
    expect(task.lastResponse).toBeNull();
    expect(task.lastPrompt).toBe("a prompt");
  });

  it("knows a task's prompt was sent until the task is abandoned, and again once the next task starts", () => {
    const clock = manualClock();
    const task = new AskTaskState(clock.now);
    const id = task.start("a prompt");
    expect(task.state).toBe("active");

    task.abandon(id);
    task.start("the next prompt");

    expect(task.state).toBe("active");
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
