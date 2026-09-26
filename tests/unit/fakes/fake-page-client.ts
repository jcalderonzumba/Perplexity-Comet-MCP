// A fake of the CDP client surface the mode page drives: `evaluate` runs the
// expression in the test's own global scope, as `Runtime.evaluate` runs it
// in the page, and reports a thrown error as CDP does, in
// `exceptionDetails`, without rejecting. Clicks and keys are recorded. Its
// tabs are the tab fake's, which it extends: connected to Perplexity's main
// page until a test moves it. Trusted input is refused, as the real client
// refuses it off Perplexity, only when a test sets `inputRefusal`.

import type { TrustedKey } from "../../../src/cdp-client.js";
import type {
  ModePageClient,
  ModeTabClient,
} from "../../../src/cdp-mode-page.js";
import type { PagePoint } from "../../../src/page-scripts.js";
import type { EvaluateResult } from "../../../src/types.js";
import { FakeTabPort } from "./fake-tab-port.js";

export class FakePageClient
  extends FakeTabPort
  implements ModePageClient, ModeTabClient
{
  public readonly expressions: string[] = [];
  public readonly clicks: PagePoint[] = [];
  public readonly keys: TrustedKey[] = [];
  public inputRefusal: Error | null = null;

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
    if (this.inputRefusal) throw this.inputRefusal;
    this.clicks.push(point);
  }

  async pressKey(key: TrustedKey): Promise<void> {
    if (this.inputRefusal) throw this.inputRefusal;
    this.keys.push(key);
  }
}
