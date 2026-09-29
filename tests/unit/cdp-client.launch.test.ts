import { describe, expect, it, vi } from "vitest";
import { CometCDPClient } from "../../src/cdp-client.js";
import { FakeCometLaunch } from "./fakes/fake-comet-launch.js";

// The client never reaches a real browser here: the fake launch says what
// answers on the port, and a reconnect that gets past it has no tab to go to.
vi.mock("chrome-remote-interface", () => ({
  default: Object.assign(
    async () => {
      throw new Error("no browser in this test");
    },
    {
      ProtocolError: class extends Error {},
    },
  ),
}));

function clientOn(port: number, launch: FakeCometLaunch): CometCDPClient {
  return new CometCDPClient({ port, launch });
}

describe("CometCDPClient.reconnect", () => {
  it("reports a Comet running without the port, naming the port and the command, and launches nothing", async () => {
    const launch = new FakeCometLaunch();
    launch.processRunning = true;

    const failure = await clientOn(9555, launch)
      .reconnect()
      .catch((e) => e);

    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain("9555");
    expect(failure.message).toContain("comet --remote-debugging-port=9555");
    expect(launch.launches).toEqual([]);
    expect(launch.probes).toEqual([9555]);
  });

  it("names the port it was given when Comet cannot be started", async () => {
    const launch = new FakeCometLaunch();
    launch.launchFailure = new Error("spawn ENOENT");

    await expect(clientOn(9555, launch).reconnect()).rejects.toThrow(
      "Cannot connect to Comet on the debug port 9555",
    );
  });

  it("probes the launch port for a running Comet, and launches only when none runs", async () => {
    const launch = new FakeCometLaunch();
    launch.answering = "Comet/140.0";

    await clientOn(9555, launch)
      .reconnect()
      .catch(() => {
        /* no tab to go to: the launch is what this test reads */
      });

    expect(launch.probes).toEqual([9555]);
    expect(launch.launches).toEqual([]);
  });
});

describe("CometCDPClient.withAutoReconnect", () => {
  it("launches nothing when the connection drops and Comet runs without the port", async () => {
    const launch = new FakeCometLaunch();
    launch.processRunning = true;
    const client = clientOn(9555, launch);

    await expect(
      client.withAutoReconnect(async () => {
        throw new Error("WebSocket is not open");
      }),
    ).rejects.toThrow("9555");

    expect(launch.launches).toEqual([]);
  });
});
