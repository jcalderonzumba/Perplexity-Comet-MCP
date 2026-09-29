// A fake of the page as `comet_upload` sees it through its port: the file
// inputs it lists, the selectors that match an input, and the files attached.
// Every call is logged by name in `calls`, so a test can show that a refusal
// reached the port with nothing.

import type { UploadPort } from "../../../src/core/upload.js";
import type {
  ValidatedSelector,
  ValidatedUploadPath,
} from "../../../src/upload-validator.js";

export class FakeUploadPort implements UploadPort {
  /** Every port call by name, oldest first. */
  public readonly calls: string[] = [];
  /** Every attach, as the path and the selector it was asked with. */
  public readonly attached: Array<{ path: string; selector: string }> = [];

  /** The selectors that match an input on the page. */
  public matching: string[] = [];
  /** One entry per input on the page: its selector, null when it has none. */
  public inputs: Array<string | null> = [];
  /** What the port fails with, per call name, instead of answering. */
  public failure: { call: string; error: Error } | null = null;

  async listFileInputs(): Promise<Array<string | null>> {
    this.calls.push("listFileInputs");
    this.failIf("listFileInputs");
    return [...this.inputs];
  }

  async attachFile(
    path: ValidatedUploadPath,
    selector: ValidatedSelector,
  ): Promise<boolean> {
    this.calls.push("attachFile");
    this.failIf("attachFile");
    this.attached.push({ path, selector });
    return this.matching.includes(selector);
  }

  private failIf(call: string): void {
    if (this.failure?.call === call) throw this.failure.error;
  }
}
