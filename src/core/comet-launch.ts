// Getting Comet onto its debug port, and never off it. The port lists what
// the platform can tell (does the debug port answer, does a Comet process
// run) and can do (launch Comet on a port); it has no way to stop a process,
// because Comet is the user's browser with the user's windows in it
// (principle 6). What to do about each answer is decided here, once, for
// `comet_connect`, for the ask's recovery and for the client's reconnect.

/** What the platform tells and does about Comet. Nothing on it kills. */
export interface CometLaunch {
  /** The browser version the debug port answers with; null when it does not. */
  probe(port: number): Promise<string | null>;
  /** True when a Comet process runs, whatever port it listens on. */
  isProcessRunning(): Promise<boolean>;
  /**
   * Launches Comet on `port` and returns the browser version once the port
   * answers. Rejects when Comet does not start or does not answer in time.
   */
  launch(port: number): Promise<string>;
  /** The command that starts Comet with the debug port on `port`. */
  startCommand(port: number): string;
}

/** Where Comet stands relative to the configured debug port. */
export type CometOnPort =
  | { readonly kind: "answering"; readonly browser: string }
  | { readonly kind: "launched"; readonly browser: string }
  | { readonly kind: "running-without-port"; readonly command: string };

/** Words for a Comet that runs without the debug port, for a reply or an error. */
export function describeRunningWithoutPort(
  port: number,
  command: string,
): string {
  return (
    `Comet is running, but not with the debug port ${port}, and this server never restarts it: ` +
    `that would close your windows. Quit Comet, then start it with the port:\n${command}`
  );
}

/** A Comet that runs without the debug port; the server leaves it alone. */
export class CometRunsWithoutPort extends Error {
  constructor(port: number, command: string) {
    super(describeRunningWithoutPort(port, command));
    this.name = "CometRunsWithoutPort";
  }
}

/**
 * Finds Comet answering on `port`, or launches it there when no Comet runs.
 * A Comet running without the port is reported, never touched.
 */
export async function ensureCometOnPort(
  launch: CometLaunch,
  port: number,
): Promise<CometOnPort> {
  const answering = await launch.probe(port);
  if (answering !== null) return { kind: "answering", browser: answering };
  if (await launch.isProcessRunning()) {
    return { kind: "running-without-port", command: launch.startCommand(port) };
  }
  return { kind: "launched", browser: await launch.launch(port) };
}

/** `ensureCometOnPort` for a caller that only needs Comet there, or a failure. */
export async function startCometOnPort(
  launch: CometLaunch,
  port: number,
): Promise<void> {
  const comet = await ensureCometOnPort(launch, port);
  if (comet.kind === "running-without-port") {
    throw new CometRunsWithoutPort(port, comet.command);
  }
}
