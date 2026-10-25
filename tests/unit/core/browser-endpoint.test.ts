import { describe, expect, it } from "vitest";
import {
  parseBrowserPath,
  parseDevToolsActivePort,
} from "../../../src/core/browser-endpoint.js";

const UUID = "0f1e2d3c-4b5a-6978-8a9b-acbdcedf0102";
const BROWSER_PATH = `/devtools/browser/${UUID}`;

describe("parseBrowserPath", () => {
  it.each([
    ["a lowercase id", BROWSER_PATH],
    ["an uppercase id", `/devtools/browser/${UUID.toUpperCase()}`],
  ])("accepts a browser path with %s", (_case, raw) => {
    expect(parseBrowserPath(raw)).toBe(raw);
  });

  it.each([
    ["a page path", `/devtools/page/${UUID}`],
    ["a full ws:// URL", `ws://127.0.0.1:9222${BROWSER_PATH}`],
    ["a path climbing with ..", `/devtools/browser/../page/${UUID}`],
    ["a path with .. after the id", `${BROWSER_PATH}/..`],
    ["a query", `${BROWSER_PATH}?x=1`],
    ["a fragment", `${BROWSER_PATH}#x`],
    ["a trailing slash", `${BROWSER_PATH}/`],
    ["a trailing newline", `${BROWSER_PATH}\n`],
    ["a short id", "/devtools/browser/0f1e2d3c-4b5a-6978-8a9b-acbdcedf010"],
    ["a non-hex id", "/devtools/browser/0f1e2d3c-4b5a-6978-8a9b-acbdcedf010g"],
    [
      "an id without its dashes",
      "/devtools/browser/0f1e2d3c4b5a69788a9bacbdcedf0102",
    ],
    ["the empty string", ""],
  ])("rejects %s", (_case, raw) => {
    expect(parseBrowserPath(raw)).toBeNull();
  });
});

describe("parseDevToolsActivePort", () => {
  it.each([
    ["the two lines Comet writes", `9222\n${BROWSER_PATH}`],
    ["a trailing newline", `9222\n${BROWSER_PATH}\n`],
  ])("accepts %s, as the port and the browser path", (_case, text) => {
    expect(parseDevToolsActivePort(text)).toEqual({
      port: 9222,
      path: BROWSER_PATH,
    });
  });

  it.each([
    ["the lowest port", "1", 1],
    ["the highest port", "65535", 65535],
  ])("accepts %s", (_case, line, port) => {
    expect(parseDevToolsActivePort(`${line}\n${BROWSER_PATH}`)?.port).toBe(
      port,
    );
  });

  it.each([
    ["an empty file", ""],
    ["a port alone", "9222\n"],
    ["port 0", `0\n${BROWSER_PATH}`],
    ["port 65536", `65536\n${BROWSER_PATH}`],
    ["a port after a space", ` 9222\n${BROWSER_PATH}`],
    ["a port with a leading zero", `09222\n${BROWSER_PATH}`],
    ["a port that is not digits", `92a2\n${BROWSER_PATH}`],
    ["a path on line 1", `${BROWSER_PATH}\n9222`],
    ["another host", `9222\nws://evil.example:9222${BROWSER_PATH}`],
    ["a host before the path", `9222\n127.0.0.1:9222${BROWSER_PATH}`],
    ["a path climbing with ..", `9222\n/devtools/browser/../page/${UUID}`],
    ["a query", `9222\n${BROWSER_PATH}?x=1`],
    ["a page path", `9222\n/devtools/page/${UUID}`],
    ["an extra line", `9222\n${BROWSER_PATH}\nextra`],
    ["two trailing newlines", `9222\n${BROWSER_PATH}\n\n`],
    ["Windows line ends", `9222\r\n${BROWSER_PATH}\r\n`],
  ])("rejects %s", (_case, text) => {
    expect(parseDevToolsActivePort(text)).toBeNull();
  });
});
