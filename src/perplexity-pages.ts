// Perplexity's pages, as the server tells them apart: the one origin trusted
// input is sent to, its home page, and the one rule that says whether an
// address is Perplexity's main page, where an ask is typed and a mode is
// switched.
//
// Comet's sidecar, the side panel's chat, lives on the same origin at
// `/sidecar`; it is Perplexity's, but it is not the main page, and an ask
// typed there never finds its answer. The rule compares the parsed origin
// and path, never a substring of the address, so a page elsewhere that
// names Perplexity in its path or query is not Perplexity's, and a thread
// whose title mentions a sidecar still is.

/** The one origin trusted input is ever sent to. */
export const PERPLEXITY_ORIGIN = "https://www.perplexity.ai";

/** Perplexity's home page, where a new chat starts. */
export const PERPLEXITY_HOME = `${PERPLEXITY_ORIGIN}/`;

const SIDECAR_PATH = "/sidecar";

/**
 * Whether `address` is Perplexity's main page: on Perplexity's origin and
 * not in the sidecar. An address that does not parse is not.
 */
export function isPerplexityMainPage(address: string): boolean {
  const url = parsed(address);
  return (
    url !== null &&
    url.origin === PERPLEXITY_ORIGIN &&
    !isSidecarPath(url.pathname)
  );
}

function isSidecarPath(path: string): boolean {
  return path === SIDECAR_PATH || path.startsWith(`${SIDECAR_PATH}/`);
}

function parsed(address: string): URL | null {
  try {
    return new URL(address);
  } catch {
    return null;
  }
}
