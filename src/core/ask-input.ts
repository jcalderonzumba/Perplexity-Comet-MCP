// The input of `comet_ask`, for every adapter alike: its arguments read and
// validated before anything reaches the browser, and the prompt shaped the
// way Comet is sent it.
//
// Validation keeps what the adapters always accepted (an absent or zero
// timeout means the default, a numeric string means its number) and refuses
// what they used to coerce into something else: a timeout that is not a
// positive number ended the wait at once, and the string "false" started a
// new chat.

/** How long an ask waits for its answer when the caller does not say. */
export const ASK_DEFAULT_TIMEOUT_MS = 120_000;

/** An ask's arguments, validated. */
export interface AskRequest {
  /** The prompt as given, before any shaping. */
  readonly prompt: string;
  readonly context: string | undefined;
  readonly newChat: boolean;
  readonly timeoutMs: number;
}

export type AskRequestReading =
  | { readonly ok: true; readonly request: AskRequest }
  | { readonly ok: false; readonly reason: string };

/** Reads and validates the tool's arguments; a refusal names the parameter. */
export function readAskRequest(
  args: Record<string, unknown> | undefined,
): AskRequestReading {
  const { prompt, context, newChat, timeout } = args ?? {};
  const promptProblem = problemWithPrompt(prompt);
  if (promptProblem) return refuse(promptProblem);
  if (!isAbsent(context) && typeof context !== "string") {
    return refuse("context must be a string");
  }
  if (!isAbsent(newChat) && typeof newChat !== "boolean") {
    return refuse("newChat must be a boolean (true or false)");
  }
  const timeoutMs = readTimeout(timeout);
  if (timeoutMs === undefined) {
    return refuse(
      "timeout must be a positive number of milliseconds, or 0 for the default",
    );
  }
  return {
    ok: true,
    request: {
      prompt: prompt as string,
      context: isAbsent(context) ? undefined : (context as string),
      newChat: newChat === true,
      timeoutMs,
    },
  };
}

function problemWithPrompt(prompt: unknown): string | undefined {
  if (isAbsent(prompt)) return "prompt cannot be empty";
  if (typeof prompt !== "string") return "prompt must be a string";
  if (prompt.trim().length === 0) return "prompt cannot be empty";
  return undefined;
}

/** The timeout in milliseconds, or undefined when it cannot be one. */
function readTimeout(timeout: unknown): number | undefined {
  if (isAbsent(timeout)) return ASK_DEFAULT_TIMEOUT_MS;
  const ms = numberOf(timeout);
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined;
  return ms === 0 ? ASK_DEFAULT_TIMEOUT_MS : ms;
}

function numberOf(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return undefined;
}

function isAbsent(value: unknown): value is undefined | null {
  return value === undefined || value === null;
}

function refuse(reason: string): AskRequestReading {
  return { ok: false, reason };
}

/** The prompt with the caller's context before it, when there is one. */
export function withContext(
  prompt: string,
  context: string | undefined,
): string {
  const trimmed = context?.trim();
  if (!trimmed) return prompt;
  return `Context for this task:\n\`\`\`\n${trimmed}\n\`\`\`\n\nBased on the above context, ${prompt}`;
}

/**
 * The prompt as Comet is sent it: on one line, without list bullets, and
 * asking the browser to browse when it names a URL or a site.
 */
export function shapePrompt(prompt: string): string {
  return rewriteForBrowsing(normalise(prompt));
}

function normalise(prompt: string): string {
  return prompt
    .replace(/^[-*•]\s*/gm, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const URL_IN_PROMPT = /https?:\/\/[^\s]+/;
const BROWSING_VERB =
  /\b(go to|visit|navigate|open|browse|check|look at|read from|click|fill|submit|login|sign in|download from)\b/i;
const SITE_WORD =
  /\b(\.com|\.org|\.io|\.net|\.ai|website|webpage|page|site)\b/i;
const ALREADY_AGENTIC =
  /^(use your browser|using your browser|open a browser|navigate to|browse to)/i;

/** Asks Comet's agent to browse when the prompt needs a page it names. */
function rewriteForBrowsing(prompt: string): string {
  const url = prompt.match(URL_IN_PROMPT)?.[0];
  const needsBrowsing =
    url !== undefined || BROWSING_VERB.test(prompt) || SITE_WORD.test(prompt);
  if (!needsBrowsing || ALREADY_AGENTIC.test(prompt)) return prompt;
  if (url !== undefined) {
    const rest = prompt.replace(url, "").trim();
    return `Use your browser to navigate to ${url} and ${rest || "tell me what you find there"}`;
  }
  const go = prompt.toLowerCase().startsWith("go") ? "" : "go and ";
  return `Use your browser to ${go}${prompt}`;
}
