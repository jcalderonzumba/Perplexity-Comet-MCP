import { describe, expect, it } from "vitest";

describe("smoke", () => {
  it("vitest toolchain is wired up", () => {
    expect(1 + 1).toBe(2);
  });
});
