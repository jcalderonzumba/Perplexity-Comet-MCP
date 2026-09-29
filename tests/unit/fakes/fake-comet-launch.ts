// A fake of the launch port: what answers on the debug port, whether a Comet
// process runs, and what a launch does. `launches` records every launch, so a
// test can show that none was made.

import type { CometLaunch } from "../../../src/core/comet-launch.js";

export const START_COMMAND = "comet --remote-debugging-port=";

export class FakeCometLaunch implements CometLaunch {
  /** The browser version the port answers with; null when nothing answers. */
  public answering: string | null = null;
  public processRunning = false;
  /** Set to make the launch fail, as a Comet that never answers does. */
  public launchFailure: Error | undefined;
  /** The browser version the port answers with once launched. */
  public launchedBrowser = "Comet/141.0";
  public readonly probes: number[] = [];
  public readonly launches: number[] = [];

  async probe(port: number): Promise<string | null> {
    this.probes.push(port);
    return this.answering;
  }

  async isProcessRunning(): Promise<boolean> {
    return this.processRunning;
  }

  async launch(port: number): Promise<string> {
    this.launches.push(port);
    if (this.launchFailure) throw this.launchFailure;
    this.answering = this.launchedBrowser;
    this.processRunning = true;
    return this.launchedBrowser;
  }

  startCommand(port: number): string {
    return `${START_COMMAND}${port}`;
  }
}
