// A tool's reply, as every core words it and every adapter renders it: the
// one type a tool handler returns. The renderers (`tool-results.ts`) put it
// in a transport's shape, switching on `kind`.

/** Words for the client; an error reply is a failure the client should see. */
export interface TextReply {
  readonly kind: "text";
  readonly text: string;
  readonly isError: boolean;
}

/** An image the client shows, as base64 data. */
export interface ImageReply {
  readonly kind: "image";
  readonly data: string;
  readonly mimeType: string;
}

export type ToolReply = TextReply | ImageReply;

export function textReply(text: string): TextReply {
  return { kind: "text", text, isError: false };
}

export function errorReply(text: string): TextReply {
  return { kind: "text", text, isError: true };
}

export function imageReply(data: string, mimeType: string): ImageReply {
  return { kind: "image", data, mimeType };
}
