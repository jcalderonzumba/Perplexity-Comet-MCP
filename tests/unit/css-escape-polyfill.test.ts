// @vitest-environment jsdom

// jsdom has no `CSS.escape`, which the page scripts call in a real browser.
// `jsdom-setup.ts` supplies it; these are the outputs Chromium (Comet 152)
// gave for the same strings, read through CDP on 2026-09-29, so the
// polyfill is held to the browser and not to a reading of the CSSOM spec.

import { describe, expect, it } from "vitest";

const CHROMIUM_ESCAPES: Array<[string, string]> = [
  ["file", "file"],
  ["a b", "a\\ b"],
  ["1x", "\\31 x"],
  ["-", "\\-"],
  ["-1", "-\\31 "],
  ['a"b', 'a\\"b'],
  ["a[0]", "a\\[0\\]"],
  ["x\u0000y", "x�y"],
  ["\u0001a", "\\1 a"],
  ["café", "café"],
  ["a.b#c", "a\\.b\\#c"],
  ["--x", "--x"],
  ["\u007f", "\\7f "],
  ["a\\b", "a\\\\b"],
  ["😀", "😀"],
];

describe("CSS.escape under jsdom", () => {
  it.each(CHROMIUM_ESCAPES)("escapes %j as Chromium does", (raw, escaped) => {
    expect(CSS.escape(raw)).toBe(escaped);
  });
});
