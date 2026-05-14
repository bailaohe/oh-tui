import type React from "react";
import { useEffect, useState } from "react";
import { Box, Text } from "ink";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

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
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const handle = setInterval(() => setI((x) => (x + 1) % FRAMES.length), intervalMs);
    return () => clearInterval(handle);
  }, [active, intervalMs]);
  if (!active) return null;
  return (
    <Box>
      <Text color="cyan">{FRAMES[i]}</Text>
      <Text dimColor> {label}…</Text>
    </Box>
  );
}
