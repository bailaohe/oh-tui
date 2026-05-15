import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { PromptInput } from "../../src/components/PromptInput.js";
import { ThemeProvider } from "../../src/theme/ThemeContext.js";

/**
 * Yield to the event loop so React effects (including ink-text-input's
 * `useInput` registration) flush before we write or assert. Without this the
 * `stdin.write` lands before Ink has subscribed to the stdin stream.
 */
const flush = async (ms = 30): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe("PromptInput (controlled)", () => {
  it("renders the cyan oh> prefix and the current value", () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <PromptInput value="hello" onChange={() => {}} onSubmit={() => {}} />
      </ThemeProvider>,
    );
    const f = lastFrame() ?? "";
    expect(f).toContain("oh>");
    expect(f).toContain("hello");
  });

  it("invokes onChange when stdin types a character", async () => {
    const observed: string[] = [];
    const { stdin } = render(
      <ThemeProvider>
        <PromptInput
          value=""
          onChange={(v) => observed.push(v)}
          onSubmit={() => {}}
        />
      </ThemeProvider>,
    );
    await flush();
    stdin.write("a");
    expect(observed).toContain("a");
  });

  it("invokes onSubmit on Enter when suppressSubmit is false", async () => {
    let submitted: string | null = null;
    const { stdin } = render(
      <ThemeProvider>
        <PromptInput
          value="x"
          onChange={() => {}}
          onSubmit={(v) => {
            submitted = v;
          }}
        />
      </ThemeProvider>,
    );
    await flush();
    stdin.write("\r");
    expect(submitted).toBe("x");
  });

  it("swallows Enter when suppressSubmit is true", async () => {
    let submitted: string | null = null;
    const { stdin } = render(
      <ThemeProvider>
        <PromptInput
          value="x"
          onChange={() => {}}
          onSubmit={(v) => {
            submitted = v;
          }}
          suppressSubmit={true}
        />
      </ThemeProvider>,
    );
    await flush();
    stdin.write("\r");
    expect(submitted).toBeNull();
  });
});
