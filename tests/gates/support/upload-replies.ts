/**
 * `comet_upload`'s replies as the upload core words them, for the battery
 * predicates' tests: each is the core answering over a fake page, through
 * the real UNTRUSTED wrapper, so a predicate is tested against the server's
 * own words and not against text a test invented.
 */
import { answerUpload } from "../../../src/core/upload.js";
import { toStdioResult } from "../../../src/tool-results.js";
import { wrapUntrustedPageContent } from "../../../src/untrusted.js";
import type { ToolReply } from "../../lib/no-pro-checks.mjs";
import { FakeUploadPort } from "../../unit/fakes/fake-upload-port.js";

/** A file the repository commits: a path the validator accepts. */
const EXISTING_FILE = import.meta.filename;

async function reply(
  args: Record<string, unknown>,
  page: FakeUploadPort,
): Promise<ToolReply> {
  return toStdioResult(
    await answerUpload(args, {
      port: page,
      quotePage: wrapUntrustedPageContent,
    }),
  );
}

/** A page with a file input `#resume` on it. */
function pageWithInput(): FakeUploadPort {
  const page = new FakeUploadPort();
  page.inputs = ["#resume"];
  page.matching = ["#resume"];
  return page;
}

/** The reply to an upload to `selector`, which matches nothing on the page. */
export function selectorNotFoundReply(selector: string) {
  return reply({ filePath: EXISTING_FILE, selector }, pageWithInput());
}

/** The reply to an upload of `filePath`, a file that does not exist. */
export function fileNotFoundReply(filePath: string) {
  return reply({ filePath }, pageWithInput());
}

/** The reply to an upload that took: the file went to the input `#resume`. */
export function uploadedReply() {
  return reply(
    { filePath: EXISTING_FILE, selector: "#resume" },
    pageWithInput(),
  );
}
