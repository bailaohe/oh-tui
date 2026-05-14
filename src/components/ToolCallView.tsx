/**
 * ToolCallView — render a single tool invocation inside an assistant turn.
 *
 * Format (one block per call):
 *   ▸ tool_name  {"arg":"..."}
 *     result snippet (only when finished)
 *
 * Icons + colors encode status: `▸ yellow` running, `✓ green` done,
 * `✗ red` error. Args are JSON-stringified and truncated so the header line
 * stays single-line; the result snippet sits one row below indented by 2
 * columns to visually nest under the call.
 */

import type React from "react";
import { Box, Text } from "ink";
import type { ToolCallState } from "../types.js";

export interface ToolCallViewProps {
  call: ToolCallState;
}

export function ToolCallView({ call }: ToolCallViewProps): React.JSX.Element {
  const icon =
    call.status === "running" ? "▸" : call.status === "done" ? "✓" : "✗";
  const color =
    call.status === "running"
      ? "yellow"
      : call.status === "done"
        ? "green"
        : "red";
  const argsBlurb = stringifyArgs(call.args);
  const hasResult =
    call.status !== "running" &&
    call.result !== undefined &&
    call.result.length > 0;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color}>{icon} </Text>
        <Text bold>{call.tool}</Text>
        {argsBlurb !== "" && <Text dimColor>  {argsBlurb}</Text>}
      </Box>
      {hasResult && (
        <Box marginLeft={2}>
          <Text dimColor>{truncate(call.result ?? "", 200)}</Text>
        </Box>
      )}
    </Box>
  );
}

function stringifyArgs(args: unknown): string {
  if (args === undefined || args === null) return "";
  if (typeof args === "string") return truncate(args, 80);
  try {
    return truncate(JSON.stringify(args), 80);
  } catch {
    return "";
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
