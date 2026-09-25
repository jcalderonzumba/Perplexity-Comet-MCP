/**
 * The live batteries' predicates and checks tested without a server: the
 * replies a tool gives, and a stand-in server that answers each call from a
 * table of them. Shared by the no-pro and the Pro battery's tests.
 */
import type { CallTool, ToolReply } from "../../lib/no-pro-checks.mjs";

/** A tool reply that is not an error result. */
export const ok = (text: string): ToolReply => ({
  content: [{ type: "text", text }],
});

/** A tool reply that is an error result. */
export const error = (text: string): ToolReply => ({
  content: [{ type: "text", text }],
  isError: true,
});

/** `comet_mode`'s reply without a mode, reporting `current`. */
export const modeReport = (current: string) =>
  [
    `Current mode: ${current}`,
    "",
    "Available modes:",
    "  search: Search",
    "  research: Deep research",
    "  labs: not available (not offered by Perplexity's current input bar)",
    "  learn: not available (not supported yet)",
    "",
  ].join("\n");

/** What a stand-in server answers to one call: a reply, or an error it throws. */
type Answer = ToolReply | Error;

/**
 * What a stand-in server answers to each call: an answer to every call with
 * that key, or a list of them, answered in turn, for a call made more than
 * once.
 */
export type Replies = Record<string, Answer | readonly Answer[]>;

/** The key of one tool call in `Replies`, and in the calls a server records. */
export const key = (name: string, args: Record<string, unknown>) =>
  `${name} ${JSON.stringify(args)}`;

/** Once the call `after` has been made, every later call rejects with `error`. */
export type Breakdown = { readonly after: string; readonly error: Error };

/**
 * The answer to the latest of `made`, the calls made so far with one key.
 * @returns undefined when there is none: no entry, or a list already used up.
 */
function answerTo(
  entry: Answer | readonly Answer[] | undefined,
  made: readonly string[],
): Answer | undefined {
  if (Array.isArray(entry)) return entry[made.length - 1];
  return entry as Answer | undefined;
}

/**
 * A stand-in for the server: answers from `replies` and records each call's
 * key in `calls`, in order. A call with no reply, or none left, rejects,
 * naming it.
 */
export function fakeServer(replies: Replies, breakdown?: Breakdown) {
  const calls: string[] = [];
  const callTool: CallTool = async (name, args) => {
    const call = key(name, args);
    const brokenDown =
      breakdown !== undefined && calls.includes(breakdown.after);
    calls.push(call);
    if (brokenDown) throw breakdown.error;
    const reply = answerTo(
      replies[call],
      calls.filter((c) => c === call),
    );
    if (reply === undefined) throw new Error(`unexpected call ${call}`);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { callTool, calls };
}
