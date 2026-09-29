// The `comet_connect` tool: get Comet onto the configured debug port, then
// put the connection on Perplexity. Comet is launched only when none runs;
// a Comet running without the port is reported with the command that starts
// it right, never restarted (principle 6, D29). The reply names the port.

import {
  type CometLaunch,
  describeRunningWithoutPort,
  ensureCometOnPort,
} from "./comet-launch.js";
import { errorReply, type ToolReply, textReply } from "./tool-reply.js";

/** The connection's tab, once Comet is on its port. */
export interface ConnectTabs {
  /** Puts the connection on Perplexity and says how, in one line. */
  connectToPerplexity(): Promise<string>;
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
  return textReply(`${stateLine}\n${await tabs.connectToPerplexity()}`);
}

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
