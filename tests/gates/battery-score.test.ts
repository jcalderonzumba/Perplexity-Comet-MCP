import { describe, expect, expectTypeOf, it } from "vitest";

import {
  batteryPassed,
  type CheckResult,
  KNOWN_FAILURES,
  type KnownFailure,
  reportLine,
  runCheck,
  type ScoredCheck,
  scoreCheck,
  summaryLine,
} from "../lib/battery-score.mjs";

const listed: KnownFailure = {
  id: "7.2-labs",
  reason: "the option moved in the page",
  owningPlan: "plan 5 (research mode)",
};

const held = (id: string, note = ""): CheckResult => ({ id, held: true, note });
const broke = (id: string, note = ""): CheckResult => ({
  id,
  held: false,
  note,
});

const scored = (verdict: ScoredCheck["verdict"]): ScoredCheck => ({
  id: "x",
  verdict,
  note: "",
});

describe("scoreCheck", () => {
  it("passes a check whose condition held and that is not listed", () => {
    expect(scoreCheck(held("5.1"), [listed]).verdict).toBe("PASS");
  });

  it("fails a check whose condition did not hold and that is not listed", () => {
    expect(scoreCheck(broke("5.1"), [listed]).verdict).toBe("FAIL");
  });

  it("marks a listed check that failed as known", () => {
    expect(scoreCheck(broke("7.2-labs"), [listed]).verdict).toBe("KNOWN");
  });

  it("marks a listed check that passed as an unexpected pass", () => {
    expect(scoreCheck(held("7.2-labs"), [listed]).verdict).toBe(
      "UNEXPECTED PASS",
    );
  });

  it("keeps the check's own note and the known entry it matched", () => {
    expect(scoreCheck(broke("7.2-labs", "timed out"), [listed])).toEqual({
      id: "7.2-labs",
      verdict: "KNOWN",
      note: "timed out",
      known: listed,
    });
  });

  it("scores against the battery's own list by default", () => {
    expect(scoreCheck(broke("7.2-learn")).verdict).toBe("KNOWN");
  });

  it("returns a verdict from the closed set, so a misspelt one fails the typecheck", () => {
    expectTypeOf(scoreCheck(held("5.1")).verdict).toEqualTypeOf<
      "PASS" | "FAIL" | "KNOWN" | "UNEXPECTED PASS"
    >();
  });
});

describe("runCheck", () => {
  it("reports what the probe decided", async () => {
    expect(
      await runCheck("6.1", async () => ({ held: true, note: "2 tabs" })),
    ).toEqual({ id: "6.1", held: true, note: "2 tabs" });
  });

  it("turns a probe that throws into a failed check with the error as its note", async () => {
    const result = await runCheck("1.2", async () => {
      throw new Error("TIMEOUT after 30000ms");
    });
    expect(result).toEqual({
      id: "1.2",
      held: false,
      note: "TIMEOUT after 30000ms",
    });
    expect(scoreCheck(result, [listed]).verdict).toBe("FAIL");
  });

  it("scores a listed probe that throws as known, still printing its error", async () => {
    const result = await runCheck("7.2-labs", () => {
      throw new Error("connection closed");
    });
    const check = scoreCheck(result, [listed]);
    expect(check.verdict).toBe("KNOWN");
    expect(reportLine(check)).toContain("connection closed");
  });

  it("reports a thrown value that is not an Error by its text", async () => {
    const result = await runCheck("9.4", () =>
      Promise.reject("socket hang up"),
    );
    expect(result.note).toBe("socket hang up");
  });
});

describe("batteryPassed", () => {
  it("passes when every check passed or is known", () => {
    expect(batteryPassed([scored("PASS"), scored("KNOWN")])).toBe(true);
  });

  it("passes on known failures alone", () => {
    expect(batteryPassed([scored("KNOWN"), scored("KNOWN")])).toBe(true);
  });

  it("fails on any failure", () => {
    expect(batteryPassed([scored("PASS"), scored("FAIL")])).toBe(false);
  });

  it("fails on an unexpected pass, so a fixed check leaves the list", () => {
    expect(batteryPassed([scored("PASS"), scored("UNEXPECTED PASS")])).toBe(
      false,
    );
  });
});

describe("summaryLine", () => {
  it("counts passed, failed and known", () => {
    expect(
      summaryLine([
        ...Array.from({ length: 8 }, () => scored("PASS")),
        scored("KNOWN"),
        scored("KNOWN"),
      ]),
    ).toBe("Results: 8 passed, 0 failed, 2 known");
  });

  it("counts an unexpected pass as failed, as it fails the battery", () => {
    expect(
      summaryLine([scored("PASS"), scored("FAIL"), scored("UNEXPECTED PASS")]),
    ).toBe("Results: 1 passed, 2 failed, 0 known");
  });
});

describe("reportLine", () => {
  it("prints the verdict, the check id and its note", () => {
    expect(
      reportLine({ id: "5.1", verdict: "PASS", note: "non-empty screenshot" }),
    ).toBe("PASS [5.1] — non-empty screenshot");
  });

  it("prints no separator when the note is empty", () => {
    expect(reportLine({ id: "6.1", verdict: "FAIL", note: "" })).toBe(
      "FAIL [6.1]",
    );
  });

  it("prints a known failure's actual note beside its listed reason and owner", () => {
    const line = reportLine(
      scoreCheck(broke("7.2-labs", "Mode option not found"), [listed]),
    );
    expect(line).toMatch(/^KNOWN \[7\.2-labs\] — Mode option not found/);
    expect(line).toContain(listed.reason);
    expect(line).toContain(listed.owningPlan);
  });

  it("prints an unexpected pass's actual note and asks for the entry to go", () => {
    const line = reportLine(
      scoreCheck(held("7.2-labs", "Switched to labs mode"), [listed]),
    );
    expect(line).toMatch(
      /^UNEXPECTED PASS \[7\.2-labs\] — Switched to labs mode/,
    );
    expect(line).toContain(listed.owningPlan);
    expect(line).toContain("remove it from the known failures");
  });
});

describe("KNOWN_FAILURES", () => {
  it("lists the labs and learn mode switches, owned by plan 5", () => {
    expect(KNOWN_FAILURES.map((entry) => [entry.id, entry.owningPlan])).toEqual(
      [
        ["7.2-labs", "plan 5 (research mode)"],
        ["7.2-learn", "plan 5 (research mode)"],
      ],
    );
  });

  it("gives every entry a unique id, a reason and an owning plan", () => {
    const ids = KNOWN_FAILURES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of KNOWN_FAILURES) {
      expect(entry.reason.trim()).not.toBe("");
      expect(entry.owningPlan).toMatch(/^plan \d+/);
    }
  });

  it("words its reasons for the public repository", () => {
    for (const entry of KNOWN_FAILURES) {
      expect(entry.reason).not.toMatch(
        /\.work\b|research note|spec §|\bD\d+\b/,
      );
    }
  });
});
