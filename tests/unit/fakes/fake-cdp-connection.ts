// A fake of the connection `chrome-remote-interface` opens to one tab, with
// just the domains `CometCDPClient.connect` and its trusted input use. The
// tab's top frame is on Perplexity until a test moves it; the page's own
// script answers whatever `pageClaims` says, so a test can make the page lie
// about where it is. Every Input call, every focus emulation switch and every
// page evaluation is recorded, the first two in one log, in the order made.

export interface TopFrame {
  url: string;
  securityOrigin: string;
}

export type InputCall =
  | { method: "Input.dispatchMouseEvent"; params: unknown }
  | { method: "Input.dispatchKeyEvent"; params: unknown }
  | { method: "Input.insertText"; params: unknown }
  | { method: "Emulation.setFocusEmulationEnabled"; params: unknown };

export class FakeCdpConnection {
  public topFrame: TopFrame = {
    url: "https://www.perplexity.ai/search/a-thread",
    securityOrigin: "https://www.perplexity.ai",
  };
  /** What the page's own script says when evaluated. */
  public pageClaims: unknown = "https://www.perplexity.ai/";
  /** Set to make the next frame tree reads fail. */
  public frameTreeError: Error | null = null;
  public frameTreeReads = 0;
  public readonly inputs: InputCall[] = [];
  public readonly evaluations: string[] = [];

  readonly Page = {
    enable: async () => {},
    setLifecycleEventsEnabled: async () => {},
    lifecycleEvent: () => () => {},
    getFrameTree: async () => {
      this.frameTreeReads++;
      if (this.frameTreeError) throw this.frameTreeError;
      return { frameTree: { frame: { ...this.topFrame } } };
    },
  };

  readonly Runtime = {
    enable: async () => {},
    evaluate: async ({ expression }: { expression: string }) => {
      this.evaluations.push(expression);
      return { result: { type: "string", value: this.pageClaims } };
    },
  };

  readonly DOM = { enable: async () => {} };
  readonly Network = { enable: async () => {} };

  readonly Input = {
    dispatchMouseEvent: async (params: unknown) => {
      this.inputs.push({ method: "Input.dispatchMouseEvent", params });
    },
    dispatchKeyEvent: async (params: unknown) => {
      this.inputs.push({ method: "Input.dispatchKeyEvent", params });
    },
    insertText: async (params: unknown) => {
      this.inputs.push({ method: "Input.insertText", params });
    },
  };

  readonly Emulation = {
    setFocusEmulationEnabled: async (params: unknown) => {
      this.inputs.push({
        method: "Emulation.setFocusEmulationEnabled",
        params,
      });
    },
  };

  async close(): Promise<void> {}

  /** Moves the tab's top frame, as a navigation the client did not make would. */
  moveTo(url: string): void {
    this.topFrame = { url, securityOrigin: new URL(url).origin };
  }
}
