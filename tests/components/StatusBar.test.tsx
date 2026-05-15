import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { StatusBar } from "../../src/components/StatusBar.js";
import { ThemeProvider } from "../../src/theme/ThemeContext.js";

function r(props: Parameters<typeof StatusBar>[0]) {
  return render(
    <ThemeProvider>
      <StatusBar {...props} />
    </ThemeProvider>,
  );
}

describe("StatusBar", () => {
  it("renders model + provider + sess segments by default", () => {
    const { lastFrame } = r({
      provider: "deepseek",
      model: "deepseek-chat",
      sessionIdShort: "a1b2c3d4",
      yolo: false,
    });
    const f = lastFrame() ?? "";
    expect(f).toContain("model: deepseek-chat");
    expect(f).toContain("provider: deepseek");
    expect(f).toContain("sess a1b2c3d4");
    expect(f).toContain("│");
  });

  it("hides the tokens segment when null", () => {
    const { lastFrame } = r({
      provider: null,
      model: null,
      sessionIdShort: null,
      yolo: false,
      tokens: null,
    });
    expect(lastFrame() ?? "").not.toContain("tokens:");
  });

  it("shows tokens segment when both counters are positive", () => {
    const { lastFrame } = r({
      provider: null,
      model: null,
      sessionIdShort: null,
      yolo: false,
      tokens: { input: 1234, output: 5678 },
    });
    const f = lastFrame() ?? "";
    expect(f).toContain("tokens:");
    expect(f).toContain("1.2k↓");
    expect(f).toContain("5.7k↑");
  });

  it("shows mode: yolo when yolo=true", () => {
    const { lastFrame } = r({
      provider: null,
      model: null,
      sessionIdShort: null,
      yolo: true,
    });
    expect(lastFrame() ?? "").toContain("mode: yolo");
  });

  it("hides yolo segment when yolo=false", () => {
    const { lastFrame } = r({
      provider: null,
      model: null,
      sessionIdShort: null,
      yolo: false,
    });
    expect(lastFrame() ?? "").not.toContain("mode:");
  });

  it("shows cancelHint instead of telemetry when both present", () => {
    const { lastFrame } = r({
      provider: null,
      model: null,
      sessionIdShort: null,
      yolo: false,
      telemetry: { event_type: "iteration_completed", elapsed_ms: 300 },
      cancelHint: "Ctrl+C to cancel",
    });
    const f = lastFrame() ?? "";
    expect(f).toContain("Ctrl+C to cancel");
    expect(f).not.toContain("iteration_completed");
  });
});
