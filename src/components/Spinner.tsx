import type React from "react";
import { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/ThemeContext.js";

export interface SpinnerProps {
  active: boolean;
  label?: string;
  intervalMs?: number;
}

export function Spinner({
  active,
  label = "thinking",
  intervalMs = 80,
}: SpinnerProps): React.JSX.Element | null {
  const { theme } = useTheme();
  const frames = theme.icons.spinner;
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const handle = setInterval(
      () => setI((x) => (x + 1) % frames.length),
      intervalMs,
    );
    return () => clearInterval(handle);
  }, [active, intervalMs, frames.length]);
  if (!active) return null;
  return (
    <Box>
      <Text color={theme.colors.primary}>{frames[i]}</Text>
      <Text dimColor> {label}…</Text>
    </Box>
  );
}
