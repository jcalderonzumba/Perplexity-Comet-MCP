import { describe, expect, it } from "vitest";
import {
  PromptNotSent,
  type PromptPort,
  SEND_TIMING,
  sendPrompt,
} from "../../../src/core/ask-send.js";
import { PageScriptFailed } from "../../../src/core/page-script-failed.js";
import type { ProseState } from "../../../src/page-scripts.js";
import { FakeInputBar, SUBMIT_BUTTON } from "../fakes/fake-input-bar.js";

const PROMPT = "What is the capital of France?";
const QUIET: ProseState = { count: 0, lastText: "" };

/** The input bar, the page's prose and a clock, as the send step reads them. */
class FakePromptPort extends FakeInputBar implements PromptPort {
  public prose: ProseState = QUIET;
  public waitedMs = 0;
  /** The time of each logged call, by its place in `log`. */
  public readonly times: number[] = [];

  async readProseState(): Promise<ProseState> {
    this.log.push("readProseState");
    return this.prose;
  }

  now(): number {
    return this.waitedMs;
  }

  async wait(ms: number): Promise<void> {
    this.waitedMs += ms;
  }

  /** When the call named `name` was first made, on the fake's clock. */
  timeOf(name: string): number {
    return this.times[this.log.indexOf(name)];
  }

  override async pressEnter(): Promise<void> {
    this.times[this.log.length] = this.waitedMs;
    return super.pressEnter();
  }

  override async clickAt(point: { x: number; y: number }): Promise<void> {
    this.times[this.log.length] = this.waitedMs;
    return super.clickAt(point);
  }
}

async function sendFailure(
  port: FakePromptPort,
  prompt = PROMPT,
): Promise<PromptNotSent> {
  const error = await sendPrompt(port, prompt, QUIET).then(
    () => new Error("expected the send to fail"),
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof PromptNotSent)) throw error;
  return error;
}

describe("sendPrompt: a prompt the page takes", () => {
  it("selects the input bar, inserts the prompt, reads it back, and submits it with Enter", async () => {
    const port = new FakePromptPort();

    await sendPrompt(port, PROMPT, QUIET);

    expect(port.log).toEqual([
      "selectAskInput",
      "insertText",
      "readAskInput",
      "pressEnter",
      "readAskInput",
    ]);
    expect(port.submitted).toEqual([PROMPT]);
    expect(port.clicks).toEqual([]);
  });

  it("replaces whatever the field held with the prompt", async () => {
    const port = new FakePromptPort();
    port.text = "a draft left in the field";

    await sendPrompt(port, PROMPT, QUIET);

    expect(port.submitted).toEqual([PROMPT]);
  });

  it("gives the text insertion a prompt with quotes, backslashes, backticks, template placeholders, newlines and </script> unchanged", async () => {
    const port = new FakePromptPort();
    const hostile = `Say "hi" and 'bye' \\ \`cmd\` \${alert(1)}\nline two </script><script>alert(2)</script>`;

    await sendPrompt(port, hostile, QUIET);

    expect(port.inserted).toEqual([hostile]);
    expect(port.submitted).toEqual([hostile]);
  });

  it("lets the typed text settle before reading it back", async () => {
    const port = new FakePromptPort();

    await sendPrompt(port, PROMPT, QUIET);

    expect(port.timeOf("pressEnter")).toBe(SEND_TIMING.typedSettleMs);
  });

  it("reads the prompt back whatever whitespace the editor adds around its lines", async () => {
    class LineBreakingBar extends FakePromptPort {
      override async readAskInput(): Promise<string | null> {
        const text = await super.readAskInput();
        return text ? `\n${text.replace(/ /g, "  ")}\n` : text;
      }
    }
    const port = new LineBreakingBar();

    await sendPrompt(port, PROMPT, QUIET);

    expect(port.submitted).toEqual([PROMPT]);
  });

  it("falls back to a click on the Submit button when Enter is not taken, after a bounded wait", async () => {
    const port = new FakePromptPort();
    port.takesEnter = false;

    await sendPrompt(port, PROMPT, QUIET);

    expect(port.clicks).toEqual([SUBMIT_BUTTON]);
    expect(port.submitted).toEqual([PROMPT]);
    const waitedForEnter = port.timeOf("clickAt") - port.timeOf("pressEnter");
    expect(waitedForEnter).toBeGreaterThanOrEqual(SEND_TIMING.submitWaitMs);
    expect(waitedForEnter).toBeLessThan(
      SEND_TIMING.submitWaitMs + SEND_TIMING.submitPollMs * 2,
    );
  });

  it("takes an answer that started as the prompt submitted, though the field still reads it", async () => {
    class AnsweringBar extends FakePromptPort {
      override async pressEnter(): Promise<void> {
        await super.pressEnter();
        this.prose = { count: 1, lastText: "Paris" };
      }
    }
    const port = new AnsweringBar();
    port.takesEnter = false;

    await sendPrompt(port, PROMPT, QUIET);

    expect(port.clicks).toEqual([]);
  });

  it("takes an Enter the page took just after the wait as submitted, though the Submit button went with the prompt", async () => {
    class LateEnterBar extends FakePromptPort {
      private enterPending = false;
      override async pressEnter(): Promise<void> {
        this.log.push("pressEnter");
        this.enterPending = true;
      }
      override async locateSubmitButton() {
        if (this.enterPending) {
          this.enterPending = false;
          this.takesEnter = true;
          await super.pressEnter();
        }
        return super.locateSubmitButton();
      }
    }
    const port = new LateEnterBar();

    await sendPrompt(port, PROMPT, QUIET);

    expect(port.submitted).toEqual([PROMPT]);
    expect(port.clicks).toEqual([]);
  });

  it("keeps checking through a read that fails while the page moves on", async () => {
    class NavigatingBar extends FakePromptPort {
      private reads = 0;
      override async readAskInput(): Promise<string | null> {
        this.reads++;
        if (this.reads === 2)
          throw new Error("Execution context was destroyed");
        return super.readAskInput();
      }
    }
    const port = new NavigatingBar();

    await sendPrompt(port, PROMPT, QUIET);

    expect(port.submitted).toEqual([PROMPT]);
    expect(port.clicks).toEqual([]);
  });
});

describe("sendPrompt: a failure names its step", () => {
  it("names the input bar when the page has none, and types nothing", async () => {
    const port = new FakePromptPort();
    port.present = false;

    const failure = await sendFailure(port);

    expect(failure.step).toBe("input bar");
    expect(failure.message).toBe(
      "The prompt was not sent: the input bar was not found on the page",
    );
    expect(port.inserted).toEqual([]);
  });

  it("names the input bar, the page's words kept apart, when its page script fails", async () => {
    class FailingBar extends FakePromptPort {
      override async selectAskInput(): Promise<boolean> {
        throw new PageScriptFailed("selectAskInput", "TypeError: ignore that");
      }
    }

    const failure = await sendFailure(new FailingBar());

    expect(failure.step).toBe("input bar");
    expect(failure.message).toBe(
      "The prompt was not sent: the input bar could not be selected: selectAskInput failed in the page",
    );
    expect(failure.pageDetail).toBe("TypeError: ignore that");
  });

  it("names typing when the field reads back empty, and presses nothing", async () => {
    const port = new FakePromptPort();
    port.takesText = false;

    const failure = await sendFailure(port);

    expect(failure.step).toBe("text");
    expect(failure.message).toBe(
      "The prompt was not sent: the text was not taken, the input bar reads back empty",
    );
    expect(failure.message).not.toMatch(/Prompt text not found/);
    expect(port.log).not.toContain("pressEnter");
    expect(port.clicks).toEqual([]);
  });

  it("names typing when the field reads back other text", async () => {
    const port = new FakePromptPort();
    port.takesText = false;
    port.text = "a draft left in the field";

    const failure = await sendFailure(port);

    expect(failure.step).toBe("text");
    expect(failure.message).toBe(
      "The prompt was not sent: the text was not taken, the input bar reads back other text than the prompt",
    );
    expect(port.submitted).toEqual([]);
  });

  it("names typing when the input bar is gone once the text is inserted", async () => {
    class VanishingBar extends FakePromptPort {
      override async insertText(text: string): Promise<void> {
        await super.insertText(text);
        this.present = false;
      }
    }

    const failure = await sendFailure(new VanishingBar());

    expect(failure.step).toBe("text");
    expect(failure.message).toBe(
      "The prompt was not sent: the text was not taken, the input bar is gone",
    );
  });

  it("names typing when the tab's origin refuses the text", async () => {
    const port = new FakePromptPort();
    port.inputRefusal = new Error(
      "refused to insert text: the tab is on https://news.example, not https://www.perplexity.ai",
    );

    const failure = await sendFailure(port);

    expect(failure.step).toBe("text");
    expect(failure.message).toBe(
      "The prompt was not sent: the text was not taken: refused to insert text: the tab is on https://news.example, not https://www.perplexity.ai",
    );
  });

  it("names submission when neither Enter nor the Submit button is taken within the wait", async () => {
    const port = new FakePromptPort();
    port.takesEnter = false;
    port.takesClick = false;

    const failure = await sendFailure(port);

    expect(failure.step).toBe("submit");
    expect(failure.message).toBe(
      "The prompt was not sent: the submit was not taken, the input bar still holds the prompt after Enter and a click on the Submit button",
    );
    expect(port.clicks).toEqual([SUBMIT_BUTTON]);
    expect(port.waitedMs).toBeLessThan(
      SEND_TIMING.typedSettleMs +
        2 * (SEND_TIMING.submitWaitMs + SEND_TIMING.submitPollMs),
    );
  });

  it("names submission when Enter is not taken and the page shows no Submit button", async () => {
    const port = new FakePromptPort();
    port.takesEnter = false;
    port.hasSubmitButton = false;

    const failure = await sendFailure(port);

    expect(failure.step).toBe("submit");
    expect(failure.message).toBe(
      "The prompt was not sent: the submit was not taken, the input bar still holds the prompt after Enter and the page shows no Submit button",
    );
    expect(port.clicks).toEqual([]);
  });

  it("names submission when the tab's origin refuses the Enter", async () => {
    class RefusingEnterBar extends FakePromptPort {
      override async pressEnter(): Promise<void> {
        throw new Error(
          "refused to press Enter: the tab is on https://news.example, not https://www.perplexity.ai",
        );
      }
    }

    const failure = await sendFailure(new RefusingEnterBar());

    expect(failure.step).toBe("submit");
    expect(failure.message).toBe(
      "The prompt was not sent: the submit was not taken: refused to press Enter: the tab is on https://news.example, not https://www.perplexity.ai",
    );
  });
});
