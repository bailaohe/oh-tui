import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { CommandPicker } from "../../src/components/CommandPicker.js";
import { ThemeProvider } from "../../src/theme/ThemeContext.js";

describe("CommandPicker", () => {
  it("renders nothing when hints is empty", () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <CommandPicker hints={[]} selectedIndex={0} />
      </ThemeProvider>,
    );
    expect((lastFrame() ?? "").trim()).toBe("");
  });

  it("renders all hints with selected marker on the chosen one", () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <CommandPicker hints={["/sessions", "/tools", "/theme"]} selectedIndex={1} />
      </ThemeProvider>,
    );
    const f = lastFrame() ?? "";
    expect(f).toContain("/sessions");
    expect(f).toContain("/tools");
    expect(f).toContain("/theme");
    expect(f).toMatch(/❯\s+\/tools/);
  });

  it("shows [enter] hint next to the selected item", () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <CommandPicker hints={["/exit"]} selectedIndex={0} />
      </ThemeProvider>,
    );
    expect(lastFrame() ?? "").toContain("[enter]");
  });

  it("shows the bottom navigation help text", () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <CommandPicker hints={["/help"]} selectedIndex={0} />
      </ThemeProvider>,
    );
    const f = lastFrame() ?? "";
    expect(f).toContain("navigate");
    expect(f).toContain("select");
    expect(f).toContain("dismiss");
  });
});
