/**
 * StatusBar — single-line footer pinned at the bottom of the REPL.
 *
 * Left side shows fixed/long-lived context (provider/model, short session id,
 * yolo flag). Right side shows the most volatile bit: a cancel/exit hint when
 * present, otherwise the latest telemetry pulse, otherwise `idle`.
 *
 * Layout: `Box justifyContent="space-between"` so left collapses on overflow
 * but right stays anchored. No border / no padding so it sits flush against
 * the prompt input and reserves only one terminal row.
 */

import type React from "react";
import { Box, Text } from "ink";

export interface StatusBarProps {
  provider: string | null;
  model: string | null;
  sessionIdShort: string | null;
  yolo: boolean;
  telemetry: { event_type: string; elapsed_ms: number } | null;
  cancelHint?: string | null;
}

export function StatusBar({
  provider,
  model,
  sessionIdShort,
  yolo,
  telemetry,
  cancelHint,
}: StatusBarProps): React.JSX.Element {
  const left: string[] = [];
  if (provider !== null) {
    left.push(provider + (model !== null ? `/${model}` : ""));
  }
  if (sessionIdShort !== null) left.push(`sess ${sessionIdShort}`);
  if (yolo) left.push("yolo");

  const right =
    cancelHint !== null && cancelHint !== undefined
      ? cancelHint
      : telemetry !== null
        ? `${telemetry.event_type} ${telemetry.elapsed_ms}ms`
        : "idle";

  return (
    <Box justifyContent="space-between">
      <Text dimColor>{left.join(" · ")}</Text>
      <Text dimColor>{right}</Text>
    </Box>
  );
}
