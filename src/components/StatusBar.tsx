/**
 * StatusBar — two-row footer pinned at the bottom of the REPL.
 *
 * Row 1: a horizontal rule (─) so the bar visually separates from the prompt.
 * Row 2: left = provider/model · sess · yolo · profile; right = cancel hint /
 *        telemetry pulse / "idle".
 *
 * Layout: the outer Box is `width="100%"` so `justifyContent="space-between"`
 * actually spreads to the terminal edges (Ink's default Box width is shrink-
 * to-content, which silently collapses the gap on small terminals).
 */

import type React from "react";
import { Box, Text } from "ink";

export interface StatusBarProps {
  provider: string | null;
  model: string | null;
  profile?: string | null;
  sessionIdShort: string | null;
  yolo: boolean;
  telemetry: { event_type: string; elapsed_ms: number } | null;
  cancelHint?: string | null;
}

export function StatusBar({
  provider,
  model,
  profile,
  sessionIdShort,
  yolo,
  telemetry,
  cancelHint,
}: StatusBarProps): React.JSX.Element {
  const left: string[] = [];
  if (provider !== null) {
    left.push(provider + (model !== null ? `/${model}` : ""));
  } else {
    left.push("(no provider)");
  }
  if (sessionIdShort !== null) left.push(`sess ${sessionIdShort}`);
  if (profile !== null && profile !== undefined && profile !== "default") {
    left.push(`@${profile}`);
  }
  if (yolo) left.push("yolo");

  const right =
    cancelHint !== null && cancelHint !== undefined
      ? cancelHint
      : telemetry !== null
        ? `${telemetry.event_type} · ${telemetry.elapsed_ms}ms`
        : "idle";

  return (
    <Box flexDirection="column" width="100%">
      <Text dimColor>{"─".repeat(60)}</Text>
      <Box width="100%" justifyContent="space-between">
        <Text color="cyan">{left.join(" │ ")}</Text>
        <Text dimColor>{right}</Text>
      </Box>
    </Box>
  );
}
