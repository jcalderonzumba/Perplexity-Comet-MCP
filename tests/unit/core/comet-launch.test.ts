import { describe, expect, it } from "vitest";
import {
  CometRunsWithoutPort,
  ensureCometOnPort,
  startCometOnPort,
} from "../../../src/core/comet-launch.js";
import { FakeCometLaunch } from "../fakes/fake-comet-launch.js";

describe("ensureCometOnPort", () => {
  it("finds Comet answering on the port and launches nothing", async () => {
    const launch = new FakeCometLaunch();
    launch.answering = "Comet/140.0";

    expect(await ensureCometOnPort(launch, 9222)).toEqual({
      kind: "answering",
      browser: "Comet/140.0",
    });
    expect(launch.probes).toEqual([9222]);
    expect(launch.launches).toEqual([]);
  });

  it("launches Comet on the port when nothing answers and no Comet runs", async () => {
    const launch = new FakeCometLaunch();

    expect(await ensureCometOnPort(launch, 9222)).toEqual({
      kind: "launched",
      browser: "Comet/141.0",
    });
    expect(launch.launches).toEqual([9222]);
  });

  it("reports a Comet that runs without the port, and launches nothing", async () => {
    const launch = new FakeCometLaunch();
    launch.processRunning = true;

    expect(await ensureCometOnPort(launch, 9222)).toEqual({
      kind: "running-without-port",
      command: "comet --remote-debugging-port=9222",
    });
    expect(launch.launches).toEqual([]);
  });

  it("lets a launch that fails reach the caller", async () => {
    const launch = new FakeCometLaunch();
    launch.launchFailure = new Error("did not answer");

    await expect(ensureCometOnPort(launch, 9222)).rejects.toThrow(
      "did not answer",
    );
  });
});

describe("startCometOnPort", () => {
  it("returns when Comet answers on the port or was launched on it", async () => {
    const running = new FakeCometLaunch();
    running.answering = "Comet/140.0";
    await expect(startCometOnPort(running, 9222)).resolves.toBeUndefined();

    const absent = new FakeCometLaunch();
    await expect(startCometOnPort(absent, 9222)).resolves.toBeUndefined();
    expect(absent.launches).toEqual([9222]);
  });

  it("throws, naming the port and the command, for a Comet that runs without the port", async () => {
    const launch = new FakeCometLaunch();
    launch.processRunning = true;

    const failure = await startCometOnPort(launch, 9222).catch((e) => e);

    expect(failure).toBeInstanceOf(CometRunsWithoutPort);
    expect(failure.message).toContain("9222");
    expect(failure.message).toContain("comet --remote-debugging-port=9222");
    expect(launch.launches).toEqual([]);
  });
});
