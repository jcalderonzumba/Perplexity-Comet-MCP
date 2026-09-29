// The `comet_upload` tool: attach a local file to a file input on the page,
// or list the page's file inputs.
//
// One order of checks for both adapters, before the page is touched: the
// file path is required and validated, then the selector when one is given,
// then `checkOnly`. The validators return branded types (`upload-validator`)
// and the port accepts nothing else, so no string a validator has not seen
// reaches the DOM calls (principle 3). The selectors of the page's own
// inputs are text the page chose: they reach a reply only through the
// UNTRUSTED wrapper (principle 1).

import { errorMessage } from "../error-message.js";
import {
  type ValidatedSelector,
  type ValidatedUploadPath,
  validateSelector,
  validateUploadPath,
} from "../upload-validator.js";
import { PageScriptFailed } from "./page-script-failed.js";
import { errorReply, type ToolReply, textReply } from "./tool-reply.js";

/** What `comet_upload` needs from the page. */
export interface UploadPort {
  /**
   * A selector for each file input on the page, in document order: null for
   * an input the page found no selector for that names it alone.
   */
  listFileInputs(): Promise<readonly (string | null)[]>;
  /**
   * Sets `path` as the file of the first element `selector` matches, as a
   * user's pick does; false when nothing matches.
   */
  attachFile(
    path: ValidatedUploadPath,
    selector: ValidatedSelector,
  ): Promise<boolean>;
}

export interface UploadDeps {
  readonly port: UploadPort;
  /** The UNTRUSTED wrapper: the only way page text reaches a reply. */
  readonly quotePage: (pageText: string) => string;
}

/**
 * Where a file input is looked for when the caller names no selector, most
 * specific first.
 */
const COMMON_FILE_INPUTS: readonly ValidatedSelector[] = [
  'input[type="file"]:not([disabled])',
  'input[type="file"]',
  '[data-testid*="file"] input',
  '[class*="upload"] input[type="file"]',
  '[class*="dropzone"] input[type="file"]',
].map(validateSelector);

/** Answers `comet_upload`. */
export async function answerUpload(
  args: Record<string, unknown>,
  deps: UploadDeps,
): Promise<ToolReply> {
  const filePath = typeof args.filePath === "string" ? args.filePath : "";
  if (!filePath) return errorReply("Error: filePath is required");

  const checked = checkedInput(filePath, args.selector);
  if ("kind" in checked) return checked;

  return viaPort(() =>
    args.checkOnly
      ? describeFileInputs(deps)
      : upload(deps, checked.path, checked.selector),
  );
}

interface CheckedInput {
  readonly path: ValidatedUploadPath;
  readonly selector: ValidatedSelector | undefined;
}

/** The validated path and selector, or the reply that refuses them. */
function checkedInput(
  filePath: string,
  selector: unknown,
): CheckedInput | ToolReply {
  try {
    const path = validateUploadPath(filePath);
    if (selector === undefined) return { path, selector: undefined };
    if (typeof selector !== "string")
      return errorReply("Error: selector must be a string");
    return { path, selector: validateSelector(selector) };
  } catch (error) {
    return errorReply(`Error: ${errorMessage(error)}`);
  }
}

/**
 * A port failure as an error reply. A page script's failure passes through:
 * its detail is page text, which the tool table quotes.
 */
async function viaPort(step: () => Promise<ToolReply>): Promise<ToolReply> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof PageScriptFailed) throw error;
    return errorReply(`Error: ${errorMessage(error)}`);
  }
}

// ============================================================================
// checkOnly
// ============================================================================

async function describeFileInputs({
  port,
  quotePage,
}: UploadDeps): Promise<ToolReply> {
  const inputs = await port.listFileInputs();
  if (inputs.length === 0) return textReply(NO_INPUTS_ON_PAGE);
  return textReply(
    `Found ${inputs.length} file input(s) on the page:\n${quotePage(numbered(inputs))}\n\nUse comet_upload with filePath to upload to one of these inputs.`,
  );
}

const NO_INPUTS_ON_PAGE =
  "No file input elements found on the current page. Navigate to a page with a file upload form first.";

/**
 * The inputs' selectors, one to a line. A selector the page suggests that
 * the caller could not pass back (the validator would refuse it) is not
 * shown: the input has no usable selector.
 */
function numbered(inputs: readonly (string | null)[]): string {
  return inputs
    .map(
      (selector, index) => `  ${index + 1}. ${usable(selector) ?? NO_SELECTOR}`,
    )
    .join("\n");
}

const NO_SELECTOR = "(no usable selector)";

function usable(selector: string | null): string | null {
  if (selector === null) return null;
  try {
    return validateSelector(selector);
  } catch {
    return null;
  }
}

// ============================================================================
// upload
// ============================================================================

async function upload(
  deps: UploadDeps,
  path: ValidatedUploadPath,
  selector: ValidatedSelector | undefined,
): Promise<ToolReply> {
  const candidates = selector ? [selector] : COMMON_FILE_INPUTS;
  for (const candidate of candidates) {
    if (await deps.port.attachFile(path, candidate)) {
      return textReply(`File uploaded successfully: ${path}`);
    }
  }
  const nothingFound = selector
    ? `No element found matching selector: ${selector}`
    : "No file input element found on the page. Try providing a specific selector.";
  return errorReply(await withAvailableInputs(deps, nothingFound));
}

/** A failure's message, with the page's file inputs when it has any. */
async function withAvailableInputs(
  { port, quotePage }: UploadDeps,
  message: string,
): Promise<string> {
  const inputs = await port.listFileInputs();
  if (inputs.length === 0) return message;
  return `${message}\n\nAvailable file inputs:\n${quotePage(numbered(inputs))}\n\nTry specifying a selector parameter.`;
}
