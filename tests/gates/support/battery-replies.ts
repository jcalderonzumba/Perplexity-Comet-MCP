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

/** What a stand-in server answers to each call: a reply, or an error it throws. */
export type Replies = Record<string, ToolReply | Error>;

/** The key of one tool call in `Replies`, and in the calls a server records. */
export const key = (name: string, args: Record<string, unknown>) =>
  `${name} ${JSON.stringify(args)}`;

/** Once the call `after` has been made, every later call rejects with `error`. */
export type Breakdown = { readonly after: string; readonly error: Error };

/**
 * A stand-in for the server: answers from `replies` and records each call's
 * key in `calls`, in order. A call with no reply rejects, naming it.
 */
export function fakeServer(replies: Replies, breakdown?: Breakdown) {
  const calls: string[] = [];
  const callTool: CallTool = async (name, args) => {
    const call = key(name, args);
    const brokenDown =
      breakdown !== undefined && calls.includes(breakdown.after);
    calls.push(call);
    if (brokenDown) throw breakdown.error;
    const reply = replies[call];
    if (reply === undefined) throw new Error(`unexpected call ${call}`);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { callTool, calls };
}
