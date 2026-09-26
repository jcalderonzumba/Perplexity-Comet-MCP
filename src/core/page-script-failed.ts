// A page script that threw in the page, as every core reports it.

/**
 * A page script that threw in the page. Its message is the server's words;
 * `pageDetail` is what the page's exception says, text the page chooses, so
 * it reaches a reply only through the adapter's UNTRUSTED wrapper.
 */
export class PageScriptFailed extends Error {
  constructor(
    readonly scriptName: string,
    readonly pageDetail: string,
  ) {
    super(`${scriptName} failed in the page`);
    this.name = "PageScriptFailed";
  }
}
