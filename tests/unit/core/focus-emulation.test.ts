import { describe, expect, it } from "vitest";
import {
  type FocusEmulationPort,
  withFocusEmulated,
} from "../../../src/core/focus-emulation.js";

/** A port that logs the calls it gets, and fails the ones it is told to. */
class LoggedPort implements FocusEmulationPort {
  readonly log: string[] = [];
  startFails: Error | undefined;
  stopFails: Error | undefined;

  async startFocusEmulation(): Promise<void> {
    this.log.push("start");
    if (this.startFails) throw this.startFails;
  }

  async stopFocusEmulation(): Promise<void> {
    this.log.push("stop");
    if (this.stopFails) throw this.stopFails;
  }
}

const rethrow = (error: unknown): never => {
  throw error;
};

describe("withFocusEmulated", () => {
  it("starts the emulation, runs the work inside it, stops it, and returns the work's value", async () => {
    const port = new LoggedPort();

    const value = await withFocusEmulated(
      port,
      async () => {
        port.log.push("work");
        return 42;
      },
      rethrow,
    );

    expect(value).toBe(42);
    expect(port.log).toEqual(["start", "work", "stop"]);
  });

  it("stops the emulation when the work throws, and rethrows the work's error", async () => {
    const port = new LoggedPort();

    await expect(
      withFocusEmulated(
        port,
        async () => {
          throw new Error("work failed");
        },
        rethrow,
      ),
    ).rejects.toThrow("work failed");
    expect(port.log).toEqual(["start", "stop"]);
  });

  it("never lets a failed stop replace the work's value", async () => {
    const port = new LoggedPort();
    port.stopFails = new Error("connection gone");

    await expect(
      withFocusEmulated(port, async () => "done", rethrow),
    ).resolves.toBe("done");
  });

  it("never lets a failed stop replace the work's error", async () => {
    const port = new LoggedPort();
    port.stopFails = new Error("connection gone");

    await expect(
      withFocusEmulated(
        port,
        async () => {
          throw new Error("work failed");
        },
        rethrow,
      ),
    ).rejects.toThrow("work failed");
  });

  it("hands a failed start to the caller's mapping, runs no work and stops nothing", async () => {
    const port = new LoggedPort();
    port.startFails = new Error("off Perplexity");
    let ran = false;

    const value = await withFocusEmulated(
      port,
      async () => {
        ran = true;
        return "worked";
      },
      (error) => `mapped: ${(error as Error).message}`,
    );

    expect(value).toBe("mapped: off Perplexity");
    expect(ran).toBe(false);
    expect(port.log).toEqual(["start"]);
  });

  it("lets the mapping throw its own error", async () => {
    const port = new LoggedPort();
    port.startFails = new Error("off Perplexity");

    await expect(
      withFocusEmulated(
        port,
        async () => "worked",
        (error) => {
          throw new TypeError(`mapped ${(error as Error).message}`);
        },
      ),
    ).rejects.toThrow("mapped off Perplexity");
  });
});
