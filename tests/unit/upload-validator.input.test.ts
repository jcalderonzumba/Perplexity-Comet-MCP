// Unit tests for validateSelector() and validateDomain(): what the two
// allowlists let through and what they refuse. Neither touches the file
// system, so nothing is mocked (the path validator's tests are in
// `upload-validator.test.ts`).

import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type ValidatedSelector,
  type ValidatedUploadPath,
  validateDomain,
  validateSelector,
  validateUploadPath,
} from "../../src/upload-validator.js";

/** The message `check` refuses `value` with. */
function refusalOf(check: (value: string) => unknown, value: string): string {
  try {
    check(value);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected a refusal");
}

describe("validateSelector", () => {
  it.each([
    'input[type="file"]',
    "input[type='file']",
    "#upload",
    ".dropzone input",
    "form > input[type=file]",
    "label + input",
    "input:not([disabled])",
    "input.a, input.b",
    '[data-kind~="file"]',
    "input\t.wide",
    "#a\\.b",
    "#\\31 23",
  ])("allows %s", (selector) => {
    expect(validateSelector(selector)).toBe(selector);
  });

  it("allows the child combinator, which the allowlist keeps on purpose", () => {
    expect(() => validateSelector("div > input")).not.toThrow();
  });

  it("allows a selector of exactly 500 characters", () => {
    const selector = `#${"a".repeat(499)}`;

    expect(validateSelector(selector)).toBe(selector);
  });

  it("refuses an empty selector", () => {
    expect(() => validateSelector("")).toThrow(/1–500 characters/);
  });

  it("refuses a selector of 501 characters", () => {
    expect(() => validateSelector(`#${"a".repeat(500)}`)).toThrow(
      /1–500 characters/,
    );
  });

  it.each([
    ["a newline", "input\n.other"],
    ["a carriage return", "input\r.other"],
    ["a null byte", "input\u0000"],
    ["an angle bracket", "input<script>"],
    ["a backtick", "input`x`"],
    ["a non-ASCII letter", "#café"],
  ])("refuses %s", (_case, selector) => {
    expect(() => validateSelector(selector)).toThrow(
      /characters not permitted/,
    );
  });

  it("does not echo the refused selector back", () => {
    expect(refusalOf(validateSelector, "<img src=x>")).not.toContain("img");
  });
});

describe("validateDomain", () => {
  it.each([
    "github.com",
    "gist.github.com",
    "a-b.example.org",
    "localhost",
    "192.168.0.1",
  ])("allows %s", (domain) => {
    expect(validateDomain(domain)).toBe(domain);
  });

  it("allows a domain of exactly 253 characters", () => {
    const domain = "a".repeat(253);

    expect(validateDomain(domain)).toBe(domain);
  });

  it("refuses an empty domain and one of 254 characters", () => {
    expect(() => validateDomain("")).toThrow(/1–253 characters/);
    expect(() => validateDomain("a".repeat(254))).toThrow(/1–253 characters/);
  });

  it.each([
    ["a scheme", "https://github.com"],
    ["a path", "github.com/octo"],
    ["a port", "github.com:443"],
    ["a user", "user@github.com"],
    ["a space", "git hub.com"],
    ["an underscore", "git_hub.com"],
    ["a non-ASCII letter", "café.example"],
    ["a newline", "github.com\n"],
  ])("refuses a domain with %s", (_case, domain) => {
    expect(() => validateDomain(domain)).toThrow(/only letters, digits/);
  });

  it("does not echo the refused domain back", () => {
    expect(refusalOf(validateDomain, "evil.example/<b>")).not.toContain("evil");
  });
});

describe("the validated types", () => {
  it("are what the validators return", () => {
    expectTypeOf(validateSelector).returns.toEqualTypeOf<ValidatedSelector>();
    expectTypeOf(
      validateUploadPath,
    ).returns.toEqualTypeOf<ValidatedUploadPath>();
  });

  it("are made by the validators only: a plain string is neither", () => {
    // @ts-expect-error a string no validator has seen is not a selector
    const selector: ValidatedSelector = "input";
    // @ts-expect-error a string no validator has seen is not an upload path
    const path: ValidatedUploadPath = "/tmp/a.txt";

    expect([selector, path]).toHaveLength(2);
  });

  it("are not interchangeable: a selector is not a path", () => {
    const selector = validateSelector("input");

    // @ts-expect-error a validated selector is not a validated path
    const path: ValidatedUploadPath = selector;

    expect(path).toBe("input");
  });
});
