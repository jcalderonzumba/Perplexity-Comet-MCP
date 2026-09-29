import { describe, expect, it } from "vitest";
import {
  ownTurnFrom,
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

describe("ownTurnFrom", () => {
  it("is the turn the page showed once the submit was confirmed, when it is above the one before", () => {
    expect(ownTurnFrom(thread(1), thread(4))).toBe(4);
  });

  it("is the turn after the one before when the confirmed page shows no newer turn yet", () => {
    expect(ownTurnFrom(thread(3), thread(3))).toBe(4);
    expect(ownTurnFrom(thread(3), thread(null))).toBe(4);
    expect(ownTurnFrom(thread(3), thread(2))).toBe(4);
  });

  it("is the first turn after a page that showed none, and the turn shown once it shows one", () => {
    expect(ownTurnFrom(thread(null), thread(null))).toBe(0);
    expect(ownTurnFrom(thread(null), thread(0))).toBe(0);
    expect(ownTurnFrom(thread(null), thread(5))).toBe(5);
  });
});

describe("showsOwnTurn", () => {
  it("is undefined on a page that shows no turn", () => {
    expect(showsOwnTurn(4, thread(null))).toBeUndefined();
  });

  it("is true from the ask's own turn on, false below it", () => {
    expect(showsOwnTurn(4, thread(3))).toBe(false);
    expect(showsOwnTurn(4, thread(4))).toBe(true);
    expect(showsOwnTurn(4, thread(5))).toBe(true);
  });
});
