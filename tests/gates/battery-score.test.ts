import { describe, expect, expectTypeOf, it } from "vitest";

import {
  batteryPassed,
  type CheckResult,
  type KnownFailure,
  NO_PRO_KNOWN_FAILURES,
  PRO_KNOWN_FAILURES,
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

  it("takes the list to score against, so no battery falls back on another's", () => {
    // @ts-expect-error: the known-failures list is required
    expect(() => scoreCheck(broke("7.2-learn"))).toThrow(TypeError);
  });

  it("returns a verdict from the closed set, so a misspelt one fails the typecheck", () => {
    expectTypeOf(scoreCheck(held("5.1"), [listed]).verdict).toEqualTypeOf<
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

describe("NO_PRO_KNOWN_FAILURES", () => {
  it("lists only the learn mode switch, owned by plan 11", () => {
    expect(
      NO_PRO_KNOWN_FAILURES.map((entry) => [entry.id, entry.owningPlan]),
    ).toEqual([["7.2-learn", "plan 11 (Learn mode)"]]);
  });

  it("no longer lists the labs mode switch, whose refusal the battery now expects", () => {
    expect(scoreCheck(held("7.2-labs"), NO_PRO_KNOWN_FAILURES).verdict).toBe(
      "PASS",
    );
    expect(scoreCheck(broke("7.2-labs"), NO_PRO_KNOWN_FAILURES).verdict).toBe(
      "FAIL",
    );
  });

  it("says why the learn mode switch fails, as the mode menu stands", () => {
    expect(NO_PRO_KNOWN_FAILURES[0]?.reason).toBe(
      'Perplexity\'s input bar offers "Learn step by step", and comet_mode does not switch to it yet',
    );
  });
});

describe("PRO_KNOWN_FAILURES", () => {
  const ASK_RELIABILITY = "plan 3 (comet_ask reliability)";
  const AGENTIC_BROWSING = "plan 12 (Agentic browsing)";

  it("lists the checks the Pro runs of 2026-09-24 to 2026-09-26 failed, and the new ones, each with its owner", () => {
    expect(
      PRO_KNOWN_FAILURES.map((entry) => [entry.id, entry.owningPlan]),
    ).toEqual([
      ["1.5", ASK_RELIABILITY],
      ["2.1", ASK_RELIABILITY],
      ["2.2", ASK_RELIABILITY],
      ["2.3", ASK_RELIABILITY],
      ["2.5", ASK_RELIABILITY],
      ["2.6-whole-answer", ASK_RELIABILITY],
      ["3.1", AGENTIC_BROWSING],
      ["3.2-agent-tab", AGENTIC_BROWSING],
      ["3.3-tabs-kept", AGENTIC_BROWSING],
      ["3.4", AGENTIC_BROWSING],
      ["4.3b", ASK_RELIABILITY],
      ["6.3", AGENTIC_BROWSING],
      ["7.2-learn", "plan 11 (Learn mode)"],
    ]);
  });

  it("no longer lists [2.4], since a timed-out ask now says its answer may be incomplete", () => {
    expect(PRO_KNOWN_FAILURES.map((entry) => entry.id)).not.toContain("2.4");
  });

  it("lists [2.5] for its submit not taken while Comet may still be answering [2.4], a cause still to confirm", () => {
    const entry = PRO_KNOWN_FAILURES.find((known) => known.id === "2.5");
    expect(entry?.reason).toMatch(/the submit is not taken/);
    expect(entry?.reason).toMatch(/still answering the previous question/);
    expect(entry?.reason).toMatch(/not yet confirmed/);
    expect(entry?.reason).not.toMatch(/Prompt text not found in input/);
  });

  it("words a short answer run to its timeout as the ask's timeout result now reads", () => {
    for (const id of ["1.5", "2.1", "2.3"]) {
      const entry = PRO_KNOWN_FAILURES.find((known) => known.id === id);
      expect(entry?.reason, id).toMatch(/says the answer may be incomplete$/);
    }
  });

  it("gives [7.2-learn] the no-pro list's entry, as both batteries judge it alike", () => {
    expect(
      PRO_KNOWN_FAILURES.find((entry) => entry.id === "7.2-learn"),
    ).toEqual(NO_PRO_KNOWN_FAILURES[0]);
  });
});

describe.each([
  ["no-pro", NO_PRO_KNOWN_FAILURES],
  ["Pro", PRO_KNOWN_FAILURES],
])("the %s battery's known failures", (_battery, knownFailures) => {
  it("give every entry a unique id, a reason and an owning plan", () => {
    const ids = knownFailures.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of knownFailures) {
      expect(entry.reason.trim()).not.toBe("");
      expect(entry.owningPlan).toMatch(/^plan \d+/);
    }
  });

  it("word their reasons for the public repository", () => {
    for (const entry of knownFailures) {
      expect(entry.reason).not.toMatch(
        /\.work\b|research note|spec §|\bD\d+\b/,
      );
    }
  });
});

describe("each battery's own known failures", () => {
  // The batteries share check ids ([1.2], [5.1], [7.x], [9.4]), so an entry
  // must excuse its id in its own battery alone.
  const proListed: KnownFailure = {
    id: "5.1",
    reason: "the screenshot comes back empty after an agentic ask",
    owningPlan: "plan 3 (comet_ask reliability)",
  };
  const proList = [proListed];
  const noProList = [listed];

  it("scores a Pro check on the Pro list as known when it fails", () => {
    expect(scoreCheck(broke("5.1"), proList)).toMatchObject({
      verdict: "KNOWN",
      known: proListed,
    });
  });

  it("scores a Pro check on the Pro list as an unexpected pass when it passes", () => {
    expect(scoreCheck(held("5.1"), proList).verdict).toBe("UNEXPECTED PASS");
  });

  it("scores the same id as unlisted in the no-pro battery", () => {
    expect(scoreCheck(broke("5.1"), noProList).verdict).toBe("FAIL");
    expect(scoreCheck(held("5.1"), noProList).verdict).toBe("PASS");
  });

  it("scores an id on the no-pro list as unlisted in the Pro battery", () => {
    expect(scoreCheck(broke("7.2-labs"), proList).verdict).toBe("FAIL");
    expect(scoreCheck(held("7.2-labs"), proList).verdict).toBe("PASS");
  });

  it("lets no no-pro entry excuse a Pro check the Pro list does not name", () => {
    const proIds = new Set(PRO_KNOWN_FAILURES.map((entry) => entry.id));
    for (const entry of NO_PRO_KNOWN_FAILURES.filter(
      (noPro) => !proIds.has(noPro.id),
    )) {
      expect(scoreCheck(broke(entry.id), PRO_KNOWN_FAILURES).verdict).toBe(
        "FAIL",
      );
    }
  });
});
