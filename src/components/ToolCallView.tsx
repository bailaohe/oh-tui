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
 *
 * Result rendering is truncated to the first 5 lines by default to keep the
 * REPL readable when tools dump large outputs (e.g. `bash`). Pass
 * `fullOutput={true}` (driven by `--full-tool-output`) to render verbatim.
 */

import type React from "react";
import { Box, Text } from "ink";
import type { ToolCallState } from "../types.js";

export interface ToolCallViewProps {
  call: ToolCallState;
  /**
   * When true, render the tool result in full. When false (default), truncate
   * to the first 5 lines with a "… N more lines" suffix.
   */
  fullOutput?: boolean;
}

export function ToolCallView({
  call,
  fullOutput = false,
}: ToolCallViewProps): React.JSX.Element {
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
          <Text dimColor>{formatResult(call.result ?? "", fullOutput)}</Text>
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

/**
 * Format a tool result for display.
 *
 * In `full` mode we return the raw result so the user sees everything (this
 * is what `--full-tool-output` opts into). Otherwise we cap at 5 lines and
 * append a "… N more lines" suffix when the result was longer. Results that
 * already fit (≤5 lines AND ≤500 chars) pass through untouched.
 */
export function formatResult(result: string, full: boolean): string {
  if (full) return result;
  const lines = result.split("\n");
  if (lines.length <= 5 && result.length <= 500) return result;
  const head = lines.slice(0, 5).join("\n");
  const more =
    lines.length > 5 ? ` … ${lines.length - 5} more lines` : ` …`;
  return head + more;
}
