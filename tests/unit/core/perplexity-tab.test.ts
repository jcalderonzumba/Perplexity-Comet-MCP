import { describe, expect, it } from "vitest";
import { PerplexityTab, TAB_TIMING } from "../../../src/core/perplexity-tab.js";
import { PERPLEXITY_HOME } from "../../../src/perplexity-pages.js";
import {
  FakeTabPort,
  LOOKALIKE_TAB,
  MAIN_TAB,
  SIDECAR_NAMED_THREAD,
  SIDECAR_TAB,
  USER_TAB,
} from "../fakes/fake-tab-port.js";

function connectedTo(...targets: (typeof MAIN_TAB)[]) {
  const port = new FakeTabPort();
  port.targets = [...targets];
  port.url = targets[0].url;
  return { port, tab: new PerplexityTab(port) };
}

describe("PerplexityTab.connectedToMainPage", () => {
  it("is true on Perplexity's main page, reading the address from the port", async () => {
    const { port, tab } = connectedTo(MAIN_TAB);

    expect(await tab.connectedToMainPage()).toBe(true);
    expect(port.calls).toEqual(["pageAddress"]);
  });

  it("is false in the sidecar", async () => {
    const { tab } = connectedTo(SIDECAR_TAB);

    expect(await tab.connectedToMainPage()).toBe(false);
  });

  it("is false on a user's page that names Perplexity in its address", async () => {
    const { tab } = connectedTo(LOOKALIKE_TAB);

    expect(await tab.connectedToMainPage()).toBe(false);
  });

  it("is true on a thread whose address names a sidecar", async () => {
    const { tab } = connectedTo(SIDECAR_NAMED_THREAD);

    expect(await tab.connectedToMainPage()).toBe(true);
  });

  it("is false when the address cannot be read", async () => {
    const { port, tab } = connectedTo(MAIN_TAB);
    port.addressFails = true;

    expect(await tab.connectedToMainPage()).toBe(false);
  });
});

describe("PerplexityTab.returnToMainPage", () => {
  it("stays on the main page it is connected to", async () => {
    const { port, tab } = connectedTo(MAIN_TAB);

    expect(await tab.returnToMainPage()).toBe(true);
    expect(port.connectedTo).toEqual([]);
  });

  it("connects from the sidecar to the main page", async () => {
    const { port, tab } = connectedTo(SIDECAR_TAB, MAIN_TAB);

    expect(await tab.returnToMainPage()).toBe(true);
    expect(port.connectedTo).toEqual([MAIN_TAB.id]);
  });

  it("connects to a thread whose address names a sidecar, not to the sidecar", async () => {
    const { port, tab } = connectedTo(
      USER_TAB,
      SIDECAR_TAB,
      SIDECAR_NAMED_THREAD,
    );

    expect(await tab.returnToMainPage()).toBe(true);
    expect(port.connectedTo).toEqual([SIDECAR_NAMED_THREAD.id]);
  });

  it("is false, opening and connecting nothing, when no main page is open", async () => {
    const { port, tab } = connectedTo(USER_TAB, SIDECAR_TAB, LOOKALIKE_TAB);

    expect(await tab.returnToMainPage()).toBe(false);
    expect(port.connectedTo).toEqual([]);
    expect(port.openedAt).toEqual([]);
  });

  it("takes only a page for the main page, not another target at its address", async () => {
    const { port, tab } = connectedTo(USER_TAB);
    port.targets.push({ ...MAIN_TAB, id: "worker", type: "service_worker" });

    expect(await tab.returnToMainPage()).toBe(false);
    expect(port.connectedTo).toEqual([]);
  });

  it("is false, rather than failing, when the tabs cannot be listed", async () => {
    const { port, tab } = connectedTo(SIDECAR_TAB);
    port.listTargets = async () => {
      throw new Error("Failed to list targets: 500");
    };

    expect(await tab.returnToMainPage()).toBe(false);
  });
});

describe("PerplexityTab.bringToMainPage", () => {
  it("stays on the main page it is connected to", async () => {
    const { port, tab } = connectedTo(MAIN_TAB);

    expect(await tab.bringToMainPage()).toBe("stayed");
    expect(port.connectedTo).toEqual([]);
    expect(port.openedAt).toEqual([]);
  });

  it("moves from the sidecar to the main page", async () => {
    const { port, tab } = connectedTo(SIDECAR_TAB, MAIN_TAB);

    expect(await tab.bringToMainPage()).toBe("moved");
    expect(port.connectedTo).toEqual([MAIN_TAB.id]);
    expect(port.openedAt).toEqual([]);
  });

  it("moves from a user's page to the main page, leaving the user's page as it was", async () => {
    const { port, tab } = connectedTo(LOOKALIKE_TAB, MAIN_TAB);

    expect(await tab.bringToMainPage()).toBe("moved");
    expect(port.connectedTo).toEqual([MAIN_TAB.id]);
    expect(port.targets).toContainEqual(LOOKALIKE_TAB);
  });

  it("opens Perplexity's home page in a new tab, and connects to it, when only the sidecar and a user's page are open", async () => {
    const { port, tab } = connectedTo(SIDECAR_TAB, USER_TAB);

    expect(await tab.bringToMainPage()).toBe("opened");
    expect(port.openedAt).toEqual([PERPLEXITY_HOME]);
    expect(port.connectedTo).toEqual(["opened-1"]);
    expect(port.targets).toEqual([
      SIDECAR_TAB,
      USER_TAB,
      { id: "opened-1", type: "page", url: PERPLEXITY_HOME },
    ]);
  });

  it("gives the tab it opened time to load", async () => {
    const { port, tab } = connectedTo(USER_TAB);

    await tab.bringToMainPage();

    expect(port.waitedMs).toBe(TAB_TIMING.openedSettleMs);
  });

  it("remembers the tabs it opened, and only those", async () => {
    const { tab } = connectedTo(SIDECAR_TAB, USER_TAB);

    await tab.bringToMainPage();

    expect(tab.opened("opened-1")).toBe(true);
    expect(tab.opened(SIDECAR_TAB.id)).toBe(false);
    expect(tab.opened(USER_TAB.id)).toBe(false);
  });

  it("reuses the tab it opened on the next call", async () => {
    const { port, tab } = connectedTo(USER_TAB);

    await tab.bringToMainPage();
    expect(await tab.bringToMainPage()).toBe("stayed");

    expect(port.openedAt).toHaveLength(1);
  });

  it("moves when the connected tab's address cannot be read", async () => {
    const { port, tab } = connectedTo(MAIN_TAB);
    port.addressFails = true;

    expect(await tab.bringToMainPage()).toBe("moved");
    expect(port.connectedTo).toEqual([MAIN_TAB.id]);
  });
});

describe("PerplexityTab.reconnectToMainPage", () => {
  it("connects again to the main page, even the one it is connected to", async () => {
    const { port, tab } = connectedTo(USER_TAB, MAIN_TAB);
    port.url = MAIN_TAB.url;

    expect(await tab.reconnectToMainPage()).toBe("moved");
    expect(port.connectedTo).toEqual([MAIN_TAB.id]);
    expect(port.calls).not.toContain("pageAddress");
  });

  it("opens a new tab when no main page is open", async () => {
    const { port, tab } = connectedTo(SIDECAR_TAB);

    expect(await tab.reconnectToMainPage()).toBe("opened");
    expect(port.openedAt).toEqual([PERPLEXITY_HOME]);
  });
});
