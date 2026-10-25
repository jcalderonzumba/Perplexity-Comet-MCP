// Getting Comet onto its debug port, and never off it. The port lists what
// the platform can tell (does the debug port answer, where does Comet's
// remote-debugging switch listen, does a Comet process run) and can do
// (launch Comet on a port); it has no way to stop a process, because Comet
// is the user's browser with the user's windows in it (principle 6). What to
// do about each answer is decided here, once, for `comet_connect`, for the
// ask's recovery and for the client's reconnect.

import type { BrowserEndpoint } from "./browser-endpoint.js";

/** A Comet that answers: its browser version, and where its browser socket is. */
export interface FoundComet {
  readonly browser: string;
  readonly endpoint: BrowserEndpoint;
}

/** What the platform tells and does about Comet. Nothing on it kills. */
export interface CometLaunch {
  /** Whether Comet's remote-debugging switch is looked for on this platform. */
  readonly usesSwitch: boolean;
  /** The Comet answering on the debug port; null when none does. */
  probe(port: number): Promise<FoundComet | null>;
  /**
   * The browser socket Comet's remote-debugging switch names, when something
   * listens on its port; null when there is none, or where `usesSwitch` is
   * false. Opens no WebSocket, so Comet asks the user nothing.
   */
  switchEndpoint(): Promise<BrowserEndpoint | null>;
  /** True when a Comet process runs, whatever port it listens on. */
  isProcessRunning(): Promise<boolean>;
  /**
   * Launches Comet on `port` and returns it once the port answers. Rejects
   * when Comet does not start or does not answer in time.
   */
  launch(port: number): Promise<FoundComet>;
  /** The command that starts Comet with the debug port on `port`. */
  startCommand(port: number): string;
}

/** A Comet that runs without the debug port, and what can be done about it. */
export interface RunningWithoutPort {
  readonly kind: "running-without-port";
  /** The command that starts Comet with the debug port. */
  readonly command: string;
  /** Whether turning the remote-debugging switch on would let it connect. */
  readonly usesSwitch: boolean;
}

/** A Comet found without a launch: by the flag, or by the switch. */
export type FoundOnPort =
  | ({ readonly kind: "answering" } & FoundComet)
  | { readonly kind: "switch"; readonly endpoint: BrowserEndpoint };

/** Where Comet stands relative to the configured debug port. */
export type CometOnPort =
  | FoundOnPort
  | ({ readonly kind: "launched" } & FoundComet)
  | RunningWithoutPort;

const SWITCH_WAY =
  "Or, without restarting Comet: open comet://inspect/#remote-debugging in Comet and turn remote debugging on.";

/** Words for a Comet that runs without the debug port, for a reply or an error. */
export function describeRunningWithoutPort(
  port: number,
  comet: Pick<RunningWithoutPort, "command" | "usesSwitch">,
): string {
  const restart =
    `Comet is running, but not with the debug port ${port}, and this server never restarts it: ` +
    `that would close your windows. Quit Comet, then start it with the port:\n${comet.command}`;
  return comet.usesSwitch ? `${restart}\n${SWITCH_WAY}` : restart;
}

/** A Comet that runs without the debug port; the server leaves it alone. */
export class CometRunsWithoutPort extends Error {
  constructor(port: number, comet: RunningWithoutPort) {
    super(describeRunningWithoutPort(port, comet));
    this.name = "CometRunsWithoutPort";
  }
}

/**
 * Comet's dialog stands between the server and its remote-debugging switch:
 * the user refused it, or has not answered it yet.
 */
export class RemoteDebuggingNotAllowed extends Error {
  private constructor(message: string) {
    super(message);
    this.name = "RemoteDebuggingNotAllowed";
  }

  /** Remembered until `comet_connect` asks again. */
  static refused(): RemoteDebuggingNotAllowed {
    return new RemoteDebuggingNotAllowed(
      "Comet refused remote debugging: its dialog was answered Deny. Call comet_connect to ask again, then click Allow in Comet.",
    );
  }

  /** The dialog is still on screen, its socket kept pending. */
  static asking(): RemoteDebuggingNotAllowed {
    return new RemoteDebuggingNotAllowed(
      "Comet is asking to allow remote debugging: click Allow in Comet's dialog, then call the tool again.",
    );
  }
}

/**
 * Comet answering on `port` with the flag, else through its remote-debugging
 * switch; null when neither. Launches nothing.
 */
export async function findCometOnPort(
  launch: CometLaunch,
  port: number,
): Promise<FoundOnPort | null> {
  const answering = await launch.probe(port);
  if (answering !== null) return { kind: "answering", ...answering };
  const endpoint = await launch.switchEndpoint();
  return endpoint === null ? null : { kind: "switch", endpoint };
}

/**
 * Finds Comet answering on `port` or through its switch, or launches it on
 * `port` when no Comet runs. A Comet running without either is reported,
 * never touched.
 */
export async function ensureCometOnPort(
  launch: CometLaunch,
  port: number,
): Promise<CometOnPort> {
  const found = await findCometOnPort(launch, port);
  if (found !== null) return found;
  if (await launch.isProcessRunning()) {
    return {
      kind: "running-without-port",
      command: launch.startCommand(port),
      usesSwitch: launch.usesSwitch,
    };
  }
  return { kind: "launched", ...(await launch.launch(port)) };
}

/** `ensureCometOnPort` for a caller that only needs Comet there, or a failure. */
export async function startCometOnPort(
  launch: CometLaunch,
  port: number,
): Promise<void> {
  const comet = await ensureCometOnPort(launch, port);
  if (comet.kind === "running-without-port") {
    throw new CometRunsWithoutPort(port, comet);
  }
}
