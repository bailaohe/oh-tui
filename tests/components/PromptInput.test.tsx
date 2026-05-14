import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { PromptInput } from "../../src/components/PromptInput.js";

// CSI escape sequences for arrow keys. ink-testing-library's `stdin.write`
// feeds raw bytes into Ink's input parser, which understands the same CSI
// sequences a real terminal emits: ESC + [ + A/B = up/down. Without the
// leading ESC byte Ink would treat the input as two literal characters.
const UP = "\x1B[A";
const DOWN = "\x1B[B";

/**
 * Yield to the event loop so React effects (including ink-text-input's
 * `useInput` registration) flush before we write or assert. Without this the
 * very first `stdin.write` after `render()` lands before Ink has subscribed
 * to the stdin stream and is silently dropped.
 */
const flush = async (ms = 30): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe("PromptInput", () => {
  it("renders the prompt prefix and an empty input by default", () => {
    const { lastFrame } = render(
      <PromptInput history={[]} onSubmit={() => {}} />,
    );
    expect(lastFrame()).toContain("oh>");
  });

  it("up arrow recalls the most recent history entry", async () => {
    const history = ["first", "second", "third"];
    const { lastFrame, stdin } = render(
      <PromptInput history={history} onSubmit={() => {}} />,
    );
    await flush(); // let useInput effect register
    stdin.write(UP);
    await flush();
    expect(lastFrame()).toContain("third");
  });

  it("down arrow past the end restores the draft", async () => {
    const { lastFrame, stdin } = render(
      <PromptInput history={["one"]} onSubmit={() => {}} />,
    );
    await flush();
    // Type "hi" into the draft slot, navigate up into history, then back down
    // past the end — we should land back on "hi".
    stdin.write("hi");
    await flush();
    stdin.write(UP);
    await flush();
    stdin.write(DOWN);
    await flush();
    expect(lastFrame()).toContain("hi");
  });
});
