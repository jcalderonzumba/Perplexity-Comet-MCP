// The `comet_connect` tool: find Comet on the configured debug port or
// through its remote-debugging switch, else launch it on the port, then put
// the connection on Perplexity. Comet is launched only when none runs; a
// Comet running without either is reported with the command that starts it
// right, never restarted (principle 6, D29). The reply names how it
// connected: the flag on its port, or the switch on its file's port.

import { errorMessage } from "../error-message.js";
import {
  type CometLaunch,
  type CometOnPort,
  describeRunningWithoutPort,
  ensureCometOnPort,
} from "./comet-launch.js";
import type { TabMove } from "./perplexity-tab.js";
import { errorReply, type ToolReply, textReply } from "./tool-reply.js";

/**
 * The connection's tab, once Comet is on its port: the tab choice the ask
 * and the mode share, so a tab connect opens is in their record. It moves
 * the connection or opens a tab, and navigates nothing (principle 6).
 */
export interface ConnectTabs {
  bringToMainPage(): Promise<TabMove>;
}

/** The browser at the other end of the connection. */
export interface ConnectedBrowser {
  /** Its version, asked over the connection. */
  version(): Promise<string>;
}

/** The client's memory of Comet's allow-remote-debugging dialog. */
export interface RemoteDebuggingDialog {
  /** Forgets a refusal, so the next socket through the switch asks again. */
  askAgain(): void;
}

export interface ConnectDeps {
  readonly launch: CometLaunch;
  /** The configured debug port. */
  readonly port: number;
  readonly tabs: ConnectTabs;
  readonly browser: ConnectedBrowser;
  readonly debugging: RemoteDebuggingDialog;
}

type ConnectedComet = Exclude<CometOnPort, { kind: "running-without-port" }>;

/**
 * Answers `comet_connect`. It always asks again: it is the one call that
 * may put Comet's dialog back on the user's screen after a refusal.
 */
export async function answerConnect({
  launch,
  port,
  tabs,
  browser,
  debugging,
}: ConnectDeps): Promise<ToolReply> {
  debugging.askAgain();
  let comet: ConnectedComet;
  try {
    const found = await ensureCometOnPort(launch, port);
    if (found.kind === "running-without-port") {
      return errorReply(describeRunningWithoutPort(port, found));
    }
    comet = found;
  } catch (failure) {
    return errorReply(launchFailed(port, launch, failure));
  }
  const tabLine = TAB_LINES[await tabs.bringToMainPage()];
  return textReply(`${await stateLine(comet, port, browser)}\n${tabLine}`);
}

const TAB_LINES: Record<TabMove, string> = {
  stayed:
    "Connected to Perplexity's main page: the connection was already on it.",
  moved:
    "Connected to Perplexity's main page: moved the connection to the tab already open on it.",
  opened: "Connected to Perplexity's main page: opened it in a new tab.",
};

/**
 * How Comet was reached. The switch's file names no version, so it is asked
 * over the connection the tab choice has opened.
 */
async function stateLine(
  comet: ConnectedComet,
  port: number,
  browser: ConnectedBrowser,
): Promise<string> {
  switch (comet.kind) {
    case "answering":
      return `Comet is running with the debug port ${port} (${comet.browser}).`;
    case "launched":
      return `Started Comet with the debug port ${port} (${comet.browser}).`;
    case "switch":
      return `Comet is running with its remote-debugging switch on port ${comet.endpoint.port} (${await browser.version()}).`;
  }
}

function launchFailed(
  port: number,
  launch: CometLaunch,
  failure: unknown,
): string {
  const reason = errorMessage(failure);
  return (
    `Could not start Comet on the debug port ${port}: ${reason}\n` +
    `Start it yourself with:\n${launch.startCommand(port)}`
  );
}
