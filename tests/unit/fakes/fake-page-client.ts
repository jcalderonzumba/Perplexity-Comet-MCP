// A fake of the CDP client surface the mode page drives: `evaluate` runs the
// expression in the test's own global scope, as `Runtime.evaluate` runs it
// in the page, and reports a thrown error as CDP does, in
// `exceptionDetails`, without rejecting. Clicks, keys, navigations and
// origin reads are recorded. The tab's origin is Perplexity's until a test
// sets another; a navigation moves it to the address's origin.

import type {
  ModePageClient,
  PerplexityNavigator,
} from "../../../src/cdp-mode-page.js";
import type { PagePoint } from "../../../src/page-scripts.js";
import type { EvaluateResult } from "../../../src/types.js";

export class FakePageClient implements ModePageClient, PerplexityNavigator {
  public readonly expressions: string[] = [];
  public readonly clicks: PagePoint[] = [];
  public readonly keys: string[] = [];
  public readonly navigations: string[] = [];
  public currentState: { currentUrl?: string } = {};
  public origin = "https://www.perplexity.ai";
  public originReads = 0;

  async evaluate(expression: string): Promise<EvaluateResult> {
    this.expressions.push(expression);
    try {
      // biome-ignore lint/security/noGlobalEval: the fake runs page expressions as CDP's Runtime.evaluate does
      const value: unknown = globalThis.eval(expression);
      return { result: { type: typeof value, value } };
    } catch (error) {
      return {
        result: { type: "object" },
        exceptionDetails: {
          text: "Uncaught",
          exception: { description: String(error) },
        },
      };
    }
  }

  async clickAt(point: PagePoint): Promise<void> {
    this.clicks.push(point);
  }

  async pageOrigin(): Promise<string> {
    this.originReads++;
    return this.origin;
  }

  async pressKey(key: string): Promise<void> {
    this.keys.push(key);
  }

  async navigate(url: string, waitForLoad = true): Promise<void> {
    this.navigations.push(`${url} wait=${waitForLoad}`);
    this.currentState = { currentUrl: url };
    this.origin = new URL(url).origin;
  }
}
