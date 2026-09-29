import { describe, expect, it } from "vitest";
import {
  ownTurnAmong,
  questionProbe,
  showsNewTurn,
  showsOwnTurn,
} from "../../../src/core/thread-turn.js";
import type { ThreadState } from "../../../src/page-scripts.js";

function thread(latestTurn: number | null): ThreadState {
  return { latestTurn, proseCount: 0, lastProseText: "" };
}

describe("showsNewTurn", () => {
  it("is undefined on a page that shows no turn", () => {
    expect(showsNewTurn(thread(2), thread(null))).toBeUndefined();
  });

  it("is true for a turn above the one before, or any turn after none", () => {
    expect(showsNewTurn(thread(2), thread(3))).toBe(true);
    expect(showsNewTurn(thread(null), thread(0))).toBe(true);
  });

  it("is false for the turn before, or a lower one", () => {
    expect(showsNewTurn(thread(2), thread(2))).toBe(false);
    expect(showsNewTurn(thread(2), thread(1))).toBe(false);
  });
});

describe("ownTurnAmong", () => {
  it("is the highest turn holding the question above the one before", () => {
    expect(ownTurnAmong([4], thread(3))).toBe(4);
    expect(ownTurnAmong([2, 5, 6], thread(3))).toBe(6);
  });

  it("is none while no turn above the one before holds the question", () => {
    expect(ownTurnAmong([], thread(3))).toBeNull();
    expect(ownTurnAmong([3], thread(3))).toBeNull();
    expect(ownTurnAmong([1, 3], thread(3))).toBeNull();
  });

  it("is any turn holding the question after a page that showed none", () => {
    expect(ownTurnAmong([0], thread(null))).toBe(0);
    expect(ownTurnAmong([], thread(null))).toBeNull();
  });
});

describe("showsOwnTurn", () => {
  it("is undefined on a page that shows no turn", () => {
    expect(showsOwnTurn(4, thread(null))).toBeUndefined();
    expect(showsOwnTurn(null, thread(null))).toBeUndefined();
  });

  it("is true from the ask's own turn on, false below it", () => {
    expect(showsOwnTurn(4, thread(3))).toBe(false);
    expect(showsOwnTurn(4, thread(4))).toBe(true);
    expect(showsOwnTurn(4, thread(5))).toBe(true);
  });

  it("is false for every turn while the own turn is not known", () => {
    expect(showsOwnTurn(null, thread(0))).toBe(false);
    expect(showsOwnTurn(null, thread(9))).toBe(false);
  });
});

describe("questionProbe", () => {
  it("is the start of the prompt, bounded", () => {
    expect(questionProbe("short")).toBe("short");
    expect(questionProbe("x".repeat(2000))).toHaveLength(500);
  });
});
