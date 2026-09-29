import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type CommandResult,
  createCometLaunch,
  type LaunchHost,
  type LaunchPlatform,
} from "../../src/comet-launch.js";

const ARGS = [
  "--remote-debugging-port=9222",
  "--remote-allow-origins=http://127.0.0.1",
];

/** A host with scripted answers; every call it receives is recorded. */
class FakeHost implements LaunchHost {
  public readonly fetched: string[] = [];
  public readonly ran: string[][] = [];
  public readonly spawned: string[][] = [];
  public readonly waits: number[] = [];
  /** How many probes fail before the port answers; Infinity: never. */
  public probesBeforeAnswer = Number.POSITIVE_INFINITY;
  public browser: string | undefined = "Comet/141.0";
  public listing: CommandResult | null = { code: 1, stdout: "" };
  public spawnFailure: Error | undefined;
  public localAppData: string | undefined = "C:\\Users\\me\\AppData\\Local";

  constructor(
    public readonly platform: LaunchPlatform,
    public readonly cometPath: string,
  ) {}

  async fetch(url: string): Promise<{
    ok: boolean;
    json: () => Promise<unknown>;
  }> {
    this.fetched.push(url);
    const answers = this.fetched.length > this.probesBeforeAnswer;
    return {
      ok: answers,
      json: async () => ({ Browser: this.browser }),
    };
  }

  async run(command: string, args: string[]): Promise<CommandResult | null> {
    this.ran.push([command, ...args]);
    return this.listing;
  }

  async spawnDetached(command: string, args: string[]): Promise<void> {
    this.spawned.push([command, ...args]);
    if (this.spawnFailure) throw this.spawnFailure;
  }

  windowsLocalAppData(): string | undefined {
    return this.localAppData;
  }

  async wait(ms: number): Promise<void> {
    this.waits.push(ms);
  }
}

const MAC = () =>
  new FakeHost("posix", "/Applications/Comet.app/Contents/MacOS/Comet");
const WINDOWS = () =>
  new FakeHost(
    "windows",
    "C:\\Users\\me\\AppData\\Local\\Perplexity\\Comet\\Application\\comet.exe",
  );
const WSL = () => new FakeHost("wsl", "unused on WSL");

describe.each([
  ["macOS and Linux", MAC],
  ["Windows", WINDOWS],
  ["WSL", WSL],
])("the launch on %s: probe", (_name, makeHost) => {
  it("asks 127.0.0.1:<port>/json/version and returns the browser it names", async () => {
    const host = makeHost();
    host.probesBeforeAnswer = 0;

    const version = await createCometLaunch(host).probe(9222);

    expect(version).toBe("Comet/141.0");
    expect(host.fetched).toEqual(["http://127.0.0.1:9222/json/version"]);
  });

  it("returns null when nothing answers", async () => {
    const host = makeHost();

    expect(await createCometLaunch(host).probe(9222)).toBeNull();
  });

  it("returns null when the fetch itself fails", async () => {
    const host = makeHost();
    host.fetch = async () => {
      throw new Error("ECONNREFUSED");
    };

    expect(await createCometLaunch(host).probe(9222)).toBeNull();
  });
});

describe("the launch on macOS and Linux", () => {
  it("finds a running Comet with pgrep", async () => {
    const host = MAC();
    host.listing = { code: 0, stdout: "123\n" };

    expect(await createCometLaunch(host).isProcessRunning()).toBe(true);
    expect(host.ran).toEqual([["pgrep", "-f", "Comet.app"]]);
  });

  it("finds none when pgrep matches nothing or cannot run", async () => {
    const host = MAC();
    expect(await createCometLaunch(host).isProcessRunning()).toBe(false);

    host.listing = null;
    expect(await createCometLaunch(host).isProcessRunning()).toBe(false);
  });

  it("launches the Comet binary with the debug port, then waits until the port answers", async () => {
    const host = MAC();
    host.probesBeforeAnswer = 2;

    const browser = await createCometLaunch(host).launch(9222);

    expect(host.spawned).toEqual([[host.cometPath, ...ARGS]]);
    expect(browser).toBe("Comet/141.0");
    expect(host.fetched).toHaveLength(3);
  });

  it("gives up naming the port when Comet never answers", async () => {
    const host = MAC();

    await expect(createCometLaunch(host).launch(9222)).rejects.toThrow(
      /did not answer on the debug port 9222/,
    );
    expect(host.fetched.length).toBeGreaterThan(1);
  });

  it("fails with the reason when the binary cannot be started", async () => {
    const host = MAC();
    host.spawnFailure = new Error("spawn ENOENT");

    await expect(createCometLaunch(host).launch(9222)).rejects.toThrow(
      /spawn ENOENT/,
    );
    expect(host.fetched).toEqual([]);
  });

  it("refuses a port outside 1 to 65535 before launching anything", async () => {
    const host = MAC();

    await expect(createCometLaunch(host).launch(70000)).rejects.toThrow(
      /Invalid port/,
    );
    expect(host.spawned).toEqual([]);
  });

  it("words the command that starts Comet with the debug port", () => {
    expect(createCometLaunch(MAC()).startCommand(9222)).toBe(
      `"/Applications/Comet.app/Contents/MacOS/Comet" ${ARGS.join(" ")}`,
    );
  });
});

describe("the launch on Windows", () => {
  it("finds a running Comet with tasklist", async () => {
    const host = WINDOWS();
    host.listing = { code: 0, stdout: "comet.exe    4242 Console\r\n" };

    expect(await createCometLaunch(host).isProcessRunning()).toBe(true);
    expect(host.ran).toEqual([
      ["tasklist", "/FI", "IMAGENAME eq comet.exe", "/NH"],
    ]);
  });

  it("finds none when tasklist lists no Comet", async () => {
    const host = WINDOWS();
    host.listing = {
      code: 0,
      stdout: "INFO: No tasks are running which match the specified criteria.",
    };

    expect(await createCometLaunch(host).isProcessRunning()).toBe(false);
  });

  it("launches comet.exe with the debug port and waits until it answers", async () => {
    const host = WINDOWS();
    host.probesBeforeAnswer = 1;

    await createCometLaunch(host).launch(9222);

    expect(host.spawned).toEqual([[host.cometPath, ...ARGS]]);
  });
});

describe("the launch on WSL", () => {
  it("finds a running Comet with the Windows tasklist", async () => {
    const host = WSL();
    host.listing = { code: 0, stdout: "comet.exe    4242 Console\r\n" };

    expect(await createCometLaunch(host).isProcessRunning()).toBe(true);
    expect(host.ran).toEqual([
      ["tasklist.exe", "/FI", "IMAGENAME eq comet.exe", "/NH"],
    ]);
  });

  it("launches Comet through PowerShell on the Windows side, with the debug port", async () => {
    const host = WSL();
    host.probesBeforeAnswer = 1;

    await createCometLaunch(host).launch(9222);

    expect(host.spawned).toEqual([
      [
        "powershell.exe",
        "-NoProfile",
        "-Command",
        "Set-Location C:\\; Start-Process -FilePath 'C:\\Users\\me\\AppData\\Local\\Perplexity\\Comet\\Application\\Comet.exe' -ArgumentList '--remote-debugging-port=9222','--remote-allow-origins=http://127.0.0.1'",
      ],
    ]);
  });

  it("doubles a quote in the path, so it stays inside PowerShell's literal", async () => {
    const host = WSL();
    host.localAppData = "C:\\Users\\o'brien\\AppData\\Local";
    host.probesBeforeAnswer = 0;

    await createCometLaunch(host).launch(9222);

    expect(host.spawned[0][3]).toContain("C:\\Users\\o''brien\\");
  });

  it("refuses a path with a control character before launching anything", async () => {
    const host = WSL();
    host.localAppData = "C:\\Users\\me\nAppData";

    await expect(createCometLaunch(host).launch(9222)).rejects.toThrow(
      /control characters/,
    );
    expect(host.spawned).toEqual([]);
  });

  it("refuses a port outside 1 to 65535 before launching anything", async () => {
    const host = WSL();

    await expect(createCometLaunch(host).launch(0)).rejects.toThrow(
      /Invalid port/,
    );
    expect(host.spawned).toEqual([]);
  });

  it("words the command that starts Comet through PowerShell", () => {
    expect(createCometLaunch(WSL()).startCommand(9222)).toBe(
      `powershell.exe -Command "Start-Process -FilePath 'C:\\Users\\me\\AppData\\Local\\Perplexity\\Comet\\Application\\Comet.exe' -ArgumentList '--remote-debugging-port=9222','--remote-allow-origins=http://127.0.0.1'"`,
    );
  });
});

describe("no way to kill Comet", () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      return statSync(path).isDirectory()
        ? sourceFiles(path)
        : path.endsWith(".ts")
          ? [path]
          : [];
    });
  }

  it("has no pkill, taskkill or kill command anywhere in src/", () => {
    const killers = /\b(pkill|killall|taskkill)\b|["']kill["']|\bkillComet\b/;
    const offenders = sourceFiles(SRC).filter((file) =>
      killers.test(readFileSync(file, "utf8")),
    );

    expect(offenders).toEqual([]);
  });
});
