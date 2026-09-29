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

/** A DOM call the client made, with its parameters. */
export interface DomCall {
  method: "DOM.querySelector" | "DOM.setFileInputFiles";
  params: unknown;
}

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
  /** Set to make the next focus emulation switch on fail. */
  public focusEnableError: Error | null = null;
  private focusEnableGate: Promise<void> | null = null;

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

  /** Every DOM query and file set, in the order made. */
  public readonly domCalls: DomCall[] = [];
  /** The selectors that match an element, by the node id they find. */
  public readonly elements = new Map<string, number>();

  readonly DOM = {
    enable: async () => {},
    getDocument: async () => ({ root: { nodeId: 1 } }),
    querySelector: async (params: { nodeId: number; selector: string }) => {
      this.domCalls.push({ method: "DOM.querySelector", params });
      return { nodeId: this.elements.get(params.selector) ?? 0 };
    },
    setFileInputFiles: async (params: { nodeId: number; files: string[] }) => {
      this.domCalls.push({ method: "DOM.setFileInputFiles", params });
    },
  };
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
    setFocusEmulationEnabled: async (params: { enabled: boolean }) => {
      this.inputs.push({
        method: "Emulation.setFocusEmulationEnabled",
        params,
      });
      if (!params.enabled) return;
      await this.focusEnableGate;
      const error = this.focusEnableError;
      this.focusEnableError = null;
      if (error) throw error;
    },
  };

  async close(): Promise<void> {}

  /**
   * Keeps every focus emulation switch on in flight, as a slow round trip
   * would, until the returned function is called. The call is already
   * recorded while it waits.
   */
  holdFocusEnables(): () => void {
    let release = () => {};
    this.focusEnableGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  }

  /** Moves the tab's top frame, as a navigation the client did not make would. */
  moveTo(url: string): void {
    this.topFrame = { url, securityOrigin: new URL(url).origin };
  }
}
