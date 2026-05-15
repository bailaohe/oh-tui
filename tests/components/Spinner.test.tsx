import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { Spinner } from "../../src/components/Spinner.js";
import { ThemeProvider } from "../../src/theme/ThemeContext.js";

describe("Spinner (with theme)", () => {
  it("renders label and a braille frame when active under default theme", () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <Spinner active={true} label="thinking" />
      </ThemeProvider>,
    );
    expect(lastFrame()).toContain("thinking");
    // 默认主题首帧是 "⠋"
    expect(lastFrame()).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u);
  });

  it("renders ASCII frames under minimal theme", () => {
    const { lastFrame } = render(
      <ThemeProvider initialTheme="minimal">
        <Spinner active={true} label="x" />
      </ThemeProvider>,
    );
    expect(lastFrame()).toMatch(/[-\\|/]/);
  });

  it("renders nothing when inactive", () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <Spinner active={false} label="x" />
      </ThemeProvider>,
    );
    expect((lastFrame() ?? "").trim()).toBe("");
  });
});
