import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { Spinner } from "../../src/components/Spinner.js";

describe("Spinner", () => {
  it("renders label when active", () => {
    const { lastFrame } = render(<Spinner active={true} label="thinking" />);
    expect(lastFrame()).toContain("thinking");
  });

  it("renders nothing when inactive", () => {
    const { lastFrame } = render(<Spinner active={false} label="x" />);
    expect(lastFrame()?.trim() ?? "").toBe("");
  });
});
