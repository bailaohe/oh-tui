/**
 * ToolCallDisplay — render a tool invocation pair (tool + tool_result) or
 * a standalone running tool. Replaces ToolCallView from Phase 12.
 *
 * Visual:
 *   ▸ Bash {"cmd":"ls"}      ← running, no result
 *   ✓ Bash {"cmd":"ls"}      ← done
 *     file.txt
 *     file2.txt
 *   ✗ Bash {"cmd":"bad"}     ← error
 *     command not found: bad
 */

import type React from "react";
import { Box, Text } from "ink";
import type { TranscriptItem } from "../types.js";
import { useTheme } from "../theme/ThemeContext.js";

export interface ToolCallDisplayProps {
  tool: TranscriptItem;          // role: "tool"
  result?: TranscriptItem;       // role: "tool_result", undefined = still running
  fullToolOutput: boolean;
}

const DEFAULT_TRUNC = 5; // 5 lines

export function ToolCallDisplay({
  tool,
  result,
  fullToolOutput,
}: ToolCallDisplayProps): React.JSX.Element {
  const { theme } = useTheme();
  const status: "running" | "done" | "error" =
    result === undefined
      ? "running"
      : result.isError === true
        ? "error"
        : "done";

  const icon =
    status === "running"
      ? "▸"
      : status === "done"
        ? theme.icons.success.trim()
        : theme.icons.error.trim();
  const color =
    status === "running"
      ? theme.colors.warning
      : status === "done"
        ? theme.colors.success
        : theme.colors.error;

  const argsBlurb = stringifyArgs(tool.toolInput);
  const resultText = result?.text ?? "";

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color}>{icon} </Text>
        <Text bold>{tool.toolName ?? "tool"}</Text>
        {argsBlurb.length > 0 && (
          <Text dimColor>  {argsBlurb}</Text>
        )}
      </Box>
      {status !== "running" && resultText.length > 0 && (
        <Box marginLeft={2}>
          <Text dimColor>{truncateOutput(resultText, fullToolOutput)}</Text>
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
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function truncateOutput(text: string, full: boolean): string {
  if (full) return text;
  const lines = text.split("\n");
  if (lines.length <= DEFAULT_TRUNC) return text;
  return `${lines.slice(0, DEFAULT_TRUNC).join("\n")}\n… ${lines.length - DEFAULT_TRUNC} more lines`;
}
