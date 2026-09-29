// The `comet_connect` tool: get Comet onto the configured debug port, then
// put the connection on Perplexity. Comet is launched only when none runs;
// a Comet running without the port is reported with the command that starts
// it right, never restarted (principle 6, D29). The reply names the port.

import {
  type CometLaunch,
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

export interface ConnectDeps {
  readonly launch: CometLaunch;
  /** The configured debug port. */
  readonly port: number;
  readonly tabs: ConnectTabs;
}

/** Answers `comet_connect`. */
export async function answerConnect({
  launch,
  port,
  tabs,
}: ConnectDeps): Promise<ToolReply> {
  let stateLine: string;
  try {
    const comet = await ensureCometOnPort(launch, port);
    if (comet.kind === "running-without-port") {
      return errorReply(describeRunningWithoutPort(port, comet.command));
    }
    stateLine =
      comet.kind === "answering"
        ? running(port, comet.browser)
        : started(port, comet.browser);
  } catch (failure) {
    return errorReply(launchFailed(port, launch, failure));
  }
  return textReply(`${stateLine}\n${TAB_LINES[await tabs.bringToMainPage()]}`);
}

const TAB_LINES: Record<TabMove, string> = {
  stayed:
    "Connected to Perplexity's main page: the connection was already on it.",
  moved:
    "Connected to Perplexity's main page: moved the connection to the tab already open on it.",
  opened: "Connected to Perplexity's main page: opened it in a new tab.",
};

function running(port: number, browser: string): string {
  return `Comet is running with the debug port ${port} (${browser}).`;
}

function started(port: number, browser: string): string {
  return `Started Comet with the debug port ${port} (${browser}).`;
}

function launchFailed(
  port: number,
  launch: CometLaunch,
  failure: unknown,
): string {
  const reason = failure instanceof Error ? failure.message : String(failure);
  return (
    `Could not start Comet on the debug port ${port}: ${reason}\n` +
    `Start it yourself with:\n${launch.startCommand(port)}`
  );
}
