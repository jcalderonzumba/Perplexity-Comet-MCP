// Minimal fake of the CDP `Input` slice that `clickAtPoint` uses.
// Implements just `dispatchMouseEvent` — enough to satisfy `MouseInputAPI` —
// and records every event in the order it was dispatched.

import type {
  MouseEventParams,
  MouseInputAPI,
} from "../../../src/cdp-client.js";

export class FakeMouseInput implements MouseInputAPI {
  /** Every event passed to `dispatchMouseEvent`, oldest first. */
  public readonly events: MouseEventParams[] = [];

  async dispatchMouseEvent(params: MouseEventParams): Promise<void> {
    this.events.push(params);
  }
}
