// Type definitions for CDP client and Comet MCP Server

export interface CDPTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
  devtoolsFrontendUrl?: string;
}

export interface CDPVersion {
  Browser: string;
  "Protocol-Version": string;
  "User-Agent": string;
  "V8-Version": string;
  "WebKit-Version": string;
  webSocketDebuggerUrl: string;
}

export interface NavigateResult {
  frameId: string;
  loaderId?: string;
  errorText?: string;
}

export interface ScreenshotResult {
  data: string; // Base64 encoded
}

export interface EvaluateResult {
  result: {
    type: string;
    value?: unknown;
    description?: string;
    objectId?: string;
  };
  exceptionDetails?: {
    text: string;
    exception?: {
      description?: string;
    };
  };
}

export interface CometState {
  connected: boolean;
  port: number;
  currentUrl?: string;
  activeTabId?: string;
}

// Tab context tracking for multi-tab workflows
export interface TabContext {
  id: string;
  url: string;
  title: string;
  purpose:
    | "main"
    | "agent-browsing"
    | "data-read"
    | "data-write"
    | "reference"
    | "unknown";
  domain: string;
  lastActivity: number;
  contentSummary?: string; // Brief description of what's on the page
  taskId?: string; // ID of the task using this tab
}

export interface TabRegistry {
  tabs: Map<string, TabContext>;
  activeTabId: string | null;
}
