/**
 * ToolUseBadge — single-line indicator for one tool invocation.
 *
 * Three lifecycle states tracked by the parent mode:
 *   - "running": tool started (▸ yellow), permission cleared, executing
 *   - "done":    tool completed successfully (✓ green)
 *   - "error":   tool returned an error result (✗ red)
 *
 * `args` is rendered as a JSON one-liner truncated to 80 chars so a
 * sprawling argv (e.g. a long bash command) doesn't blow out the layout.
 * The truncation is purely visual — the full payload still flows through
 * the bridge / trace event stream untouched.
 */

import type React from "react";
import { Box, Text } from "ink";

export type ToolBadgeStatus = "running" | "done" | "error";

export interface ToolUseBadgeProps {
  tool: string;
  status: ToolBadgeStatus;
  args?: unknown;
}

const STATUS_ICON: Record<ToolBadgeStatus, string> = {
  running: "▸",
  done: "✓",
  error: "✗",
};

const STATUS_COLOR: Record<ToolBadgeStatus, string> = {
  running: "yellow",
  done: "green",
  error: "red",
};

export function ToolUseBadge({
  tool,
  status,
  args,
}: ToolUseBadgeProps): React.JSX.Element {
  // Best-effort stringify; falls back to a placeholder for non-serializable
  // payloads (cyclic refs, BigInt, etc.) rather than crashing the render.
  let argsLine: string | null = null;
  if (args !== undefined) {
    try {
      argsLine = JSON.stringify(args).slice(0, 80);
    } catch {
      argsLine = "[unserializable]";
    }
  }

  return (
    <Box>
      <Text color={STATUS_COLOR[status]}>{STATUS_ICON[status]} </Text>
      <Text bold>{tool}</Text>
      {argsLine !== null && <Text dimColor> {argsLine}</Text>}
    </Box>
  );
}
