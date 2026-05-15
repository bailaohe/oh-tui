import type React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";
import {
  ThemeProvider,
  useTheme,
} from "../../src/theme/ThemeContext.js";

function Probe({ onTheme }: { onTheme: (name: string) => void }): React.JSX.Element {
  const { themeName } = useTheme();
  onTheme(themeName);
  return <Text>{themeName}</Text>;
}

describe("ThemeContext", () => {
  it("uses initialTheme when known", () => {
    let observed = "";
    render(
      <ThemeProvider initialTheme="dark">
        <Probe onTheme={(n) => (observed = n)} />
      </ThemeProvider>,
    );
    expect(observed).toBe("dark");
  });

  it("falls back to default when initialTheme is unknown", () => {
    let observed = "";
    render(
      <ThemeProvider initialTheme="not-a-real-theme">
        <Probe onTheme={(n) => (observed = n)} />
      </ThemeProvider>,
    );
    expect(observed).toBe("default");
  });

  it("default theme exposes braille spinner frames", () => {
    let frames: string[] = [];
    function Inspect(): React.JSX.Element {
      const { theme } = useTheme();
      frames = theme.icons.spinner;
      return <Text>x</Text>;
    }
    render(
      <ThemeProvider>
        <Inspect />
      </ThemeProvider>,
    );
    expect(frames).toContain("⠋");
    expect(frames.length).toBeGreaterThan(5);
  });
});
