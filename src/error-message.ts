// The words of anything thrown, as the server reports a failure.

/** An error's own message, or the text of anything else thrown. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
