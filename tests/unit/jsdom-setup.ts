// jsdom setup: polyfills for APIs jsdom intentionally does not implement
// because they would require a layout engine.
//
// `innerText` is the main one — production code calls it on prose blocks
// and the document body. jsdom returns `undefined`, which crashes the
// page-side extractors. We back it with `textContent`, which is close
// enough for our text-pattern assertions.
//
// Loaded by `vitest.config.ts` via `setupFiles`.

if (typeof HTMLElement !== "undefined") {
  const proto = HTMLElement.prototype as HTMLElement & { innerText?: string };
  if (!Object.getOwnPropertyDescriptor(proto, "innerText")) {
    Object.defineProperty(proto, "innerText", {
      configurable: true,
      get(this: HTMLElement) {
        return this.textContent ?? "";
      },
      set(this: HTMLElement, value: string) {
        this.textContent = value;
      },
    });
  }
}

// `CSS.escape`, which page scripts call to build selectors from a page's own
// attributes and which jsdom lacks. This is the algorithm of CSSOM's
// "serialize an identifier"; `css-escape-polyfill.test.ts` holds it to the
// outputs of Chromium.
if (
  typeof HTMLElement !== "undefined" &&
  typeof (globalThis as { CSS?: { escape?: unknown } }).CSS?.escape !==
    "function"
) {
  const isDigit = (code: number) => code >= 0x30 && code <= 0x39;
  const isNameCode = (code: number) =>
    code >= 0x80 ||
    code === 0x2d ||
    code === 0x5f ||
    isDigit(code) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a);

  const escapeIdentifier = (value: string): string => {
    const text = String(value);
    if (text === "-") return "\\-";
    const first = text.charCodeAt(0);
    let escaped = "";
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      const asCodePoint =
        (code >= 0x01 && code <= 0x1f) ||
        code === 0x7f ||
        (index === 0 && isDigit(code)) ||
        (index === 1 && isDigit(code) && first === 0x2d);
      if (code === 0) escaped += "�";
      else if (asCodePoint) escaped += `\\${code.toString(16)} `;
      else if (isNameCode(code)) escaped += text.charAt(index);
      else escaped += `\\${text.charAt(index)}`;
    }
    return escaped;
  };

  Object.defineProperty(globalThis, "CSS", {
    configurable: true,
    value: { escape: escapeIdentifier },
  });
}
