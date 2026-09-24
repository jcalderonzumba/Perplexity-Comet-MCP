import { describe, expect, it } from "vitest";
import { CometCDPClient, clickAtPoint } from "../../src/cdp-client.js";
import { FakeMouseInput } from "./fakes/fake-mouse-input.js";

describe("clickAtPoint", () => {
  it("moves to the point, then presses and releases the left button once", async () => {
    const input = new FakeMouseInput();

    await clickAtPoint(input, { x: 412.5, y: 87 });

    expect(input.events).toEqual([
      { type: "mouseMoved", x: 412.5, y: 87 },
      {
        type: "mousePressed",
        x: 412.5,
        y: 87,
        button: "left",
        clickCount: 1,
      },
      {
        type: "mouseReleased",
        x: 412.5,
        y: 87,
        button: "left",
        clickCount: 1,
      },
    ]);
  });

  it("does not press until the move has been dispatched", async () => {
    const order: string[] = [];
    let releaseMove: () => void = () => {};
    const input = {
      dispatchMouseEvent: ({ type }: { type: string }) => {
        order.push(`start ${type}`);
        if (type !== "mouseMoved") return Promise.resolve();
        return new Promise<void>((resolve) => {
          releaseMove = () => {
            order.push("end mouseMoved");
            resolve();
          };
        });
      },
    };

    const click = clickAtPoint(input, { x: 1, y: 2 });
    await Promise.resolve();
    expect(order).toEqual(["start mouseMoved"]);

    releaseMove();
    await click;
    expect(order).toEqual([
      "start mouseMoved",
      "end mouseMoved",
      "start mousePressed",
      "start mouseReleased",
    ]);
  });
});

describe("CometCDPClient.clickAt", () => {
  it("fails with the not-connected error before any connection exists", async () => {
    const client = new CometCDPClient();

    await expect(client.clickAt({ x: 10, y: 20 })).rejects.toThrow(
      "Not connected to Comet. Call connect() first.",
    );
  });
});
