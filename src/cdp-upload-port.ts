// The `comet_upload` port over the CDP client: the page's file inputs, read
// by a page script, and a file attached through the protocol.

import { PageScriptFailed } from "./core/page-script-failed.js";
import type { UploadPort } from "./core/upload.js";
import { listFileInputs, pageScriptExpression } from "./page-scripts.js";
import type { EvaluateResult } from "./types.js";
import type {
  ValidatedSelector,
  ValidatedUploadPath,
} from "./upload-validator.js";

/** The part of the CDP client `comet_upload` drives. */
export interface UploadClient {
  safeEvaluate(expression: string): Promise<EvaluateResult>;
  attachFile(
    path: ValidatedUploadPath,
    selector: ValidatedSelector,
  ): Promise<boolean>;
}

/** The upload port over `client`. */
export function createCdpUploadPort(client: UploadClient): UploadPort {
  return {
    listFileInputs: () => readFileInputs(client),
    attachFile: (path, selector) => client.attachFile(path, selector),
  };
}

async function readFileInputs(
  client: UploadClient,
): Promise<Array<string | null>> {
  const response = await client.safeEvaluate(
    pageScriptExpression(listFileInputs),
  );
  if (response.exceptionDetails) {
    const { exception, text } = response.exceptionDetails;
    throw new PageScriptFailed(
      listFileInputs.name,
      exception?.description ?? text,
    );
  }
  const selectors: unknown = response.result.value;
  if (!Array.isArray(selectors)) {
    throw new Error("The page did not return a list of file inputs");
  }
  return selectors.map((selector) =>
    typeof selector === "string" ? selector : null,
  );
}
