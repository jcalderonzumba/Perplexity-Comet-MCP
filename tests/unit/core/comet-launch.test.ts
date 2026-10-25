import { describe, expect, it } from "vitest";
import {
  CometRunsWithoutPort,
  describeRunningWithoutPort,
  ensureCometOnPort,
  findCometOnPort,
  RemoteDebuggingNotAllowed,
  startCometOnPort,
} from "../../../src/core/comet-launch.js";
import {
  endpointOn,
  FAKE_BROWSER_PATH,
  FakeCometLaunch,
} from "../fakes/fake-comet-launch.js";

const SWITCH_LINE =
  "Or, without restarting Comet: open comet://inspect/#remote-debugging in Comet and turn remote debugging on.";

describe("ensureCometOnPort", () => {
  it("finds Comet answering on the port, with its browser socket there, and launches nothing", async () => {
    const launch = new FakeCometLaunch();
    launch.answering = "Comet/140.0";

    expect(await ensureCometOnPort(launch, 9222)).toEqual({
      kind: "answering",
      browser: "Comet/140.0",
      endpoint: { port: 9222, path: FAKE_BROWSER_PATH },
    });
    expect(launch.probes).toEqual([9222]);
    expect(launch.switchReads).toBe(0);
    expect(launch.launches).toEqual([]);
  });

  it("finds Comet through its remote-debugging switch when the port does not answer, and launches nothing", async () => {
    const launch = new FakeCometLaunch();
    launch.switchAt = endpointOn(9333);
    launch.processRunning = true;

    expect(await ensureCometOnPort(launch, 9222)).toEqual({
      kind: "switch",
      endpoint: { port: 9333, path: FAKE_BROWSER_PATH },
    });
    expect(launch.probes).toEqual([9222]);
    expect(launch.processChecks).toBe(0);
    expect(launch.launches).toEqual([]);
  });

  it("launches Comet on the port when nothing answers and no Comet runs, with its browser socket there", async () => {
    const launch = new FakeCometLaunch();

    expect(await ensureCometOnPort(launch, 9222)).toEqual({
      kind: "launched",
      browser: "Comet/141.0",
      endpoint: { port: 9222, path: FAKE_BROWSER_PATH },
    });
    expect(launch.launches).toEqual([9222]);
  });

  it("reports a Comet that runs without the port, and launches nothing", async () => {
    const launch = new FakeCometLaunch();
    launch.processRunning = true;

    expect(await ensureCometOnPort(launch, 9222)).toEqual({
      kind: "running-without-port",
      command: "comet --remote-debugging-port=9222",
      usesSwitch: true,
    });
    expect(launch.switchReads).toBe(1);
    expect(launch.launches).toEqual([]);
  });

  it("says where the platform does not look for the switch", async () => {
    const launch = new FakeCometLaunch();
    launch.usesSwitch = false;
    launch.processRunning = true;

    expect(await ensureCometOnPort(launch, 9222)).toMatchObject({
      kind: "running-without-port",
      usesSwitch: false,
    });
  });

  it("lets a launch that fails reach the caller", async () => {
    const launch = new FakeCometLaunch();
    launch.launchFailure = new Error("did not answer");

    await expect(ensureCometOnPort(launch, 9222)).rejects.toThrow(
      "did not answer",
    );
  });
});

describe("findCometOnPort", () => {
  it("finds the flag first, then the switch, and neither launches nor looks for a process", async () => {
    const launch = new FakeCometLaunch();
    launch.switchAt = endpointOn(9333);

    expect(await findCometOnPort(launch, 9222)).toEqual({
      kind: "switch",
      endpoint: { port: 9333, path: FAKE_BROWSER_PATH },
    });
    launch.answering = "Comet/140.0";
    expect(await findCometOnPort(launch, 9222)).toMatchObject({
      kind: "answering",
      endpoint: { port: 9222 },
    });
    expect(launch.switchReads).toBe(1);
    expect(launch.processChecks).toBe(0);
    expect(launch.launches).toEqual([]);
  });

  it("is null when neither the flag nor the switch answers", async () => {
    expect(await findCometOnPort(new FakeCometLaunch(), 9222)).toBeNull();
  });
});

describe("describeRunningWithoutPort", () => {
  const command = "comet --remote-debugging-port=9222";

  it("names the port and the command, then the way with no restart, where the switch is used", () => {
    const words = describeRunningWithoutPort(9222, {
      command,
      usesSwitch: true,
    });

    expect(words).toBe(
      "Comet is running, but not with the debug port 9222, and this server never restarts it: " +
        `that would close your windows. Quit Comet, then start it with the port:\n${command}\n${SWITCH_LINE}`,
    );
  });

  it("leaves the switch out where the server does not look for it", () => {
    const words = describeRunningWithoutPort(9222, {
      command,
      usesSwitch: false,
    });

    expect(words).not.toContain("comet://inspect");
    expect(words.endsWith(command)).toBe(true);
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

    const onTheSwitch = new FakeCometLaunch();
    onTheSwitch.switchAt = endpointOn(9333);
    await expect(startCometOnPort(onTheSwitch, 9222)).resolves.toBeUndefined();
    expect(onTheSwitch.launches).toEqual([]);
  });

  it("throws, naming the port and the command, for a Comet that runs without the port", async () => {
    const launch = new FakeCometLaunch();
    launch.processRunning = true;

    const failure = await startCometOnPort(launch, 9222).catch((e) => e);

    expect(failure).toBeInstanceOf(CometRunsWithoutPort);
    expect(failure.message).toContain("9222");
    expect(failure.message).toContain("comet --remote-debugging-port=9222");
    expect(failure.message).toContain(SWITCH_LINE);
    expect(launch.launches).toEqual([]);
  });
});

describe("RemoteDebuggingNotAllowed", () => {
  it("words a refused dialog with the way to ask again", () => {
    expect(RemoteDebuggingNotAllowed.refused().message).toBe(
      "Comet refused remote debugging: its dialog was answered Deny. Call comet_connect to ask again, then click Allow in Comet.",
    );
  });

  it("words a dialog still waiting with what to click", () => {
    expect(RemoteDebuggingNotAllowed.asking().message).toBe(
      "Comet is asking to allow remote debugging: click Allow in Comet's dialog, then call the tool again.",
    );
  });
});
