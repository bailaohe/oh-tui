/**
 * PermissionDialog — interactive approval modal for tool invocations.
 *
 * Rendered above the streaming message when the bridge issues a
 * `permission/request` and the user has not opted into `--yolo`. The dialog
 * is intentionally minimal: a bordered box showing the tool name, a
 * truncated JSON one-liner of the args, and a hint line listing the three
 * keys we accept:
 *   - `y` → allow (one-shot grant for this call)
 *   - `n` → deny  (the engine surfaces a rejection back to the model)
 *   - `a` → allow_always (the engine remembers the grant for this session)
 *
 * Every other key is ignored on purpose; we don't want a stray Enter or
 * arrow key to leak through as a decision. The component is stateless —
 * the parent (OneShotMode) owns the in-flight Promise and supplies a
 * single `onDecide` callback that resolves it.
 */

import type React from "react";
import { Box, Text, useInput } from "ink";
import type { PermissionDecision } from "@meta-harney/bridge-client";

export interface PermissionDialogProps {
  tool: string;
  args: unknown;
  onDecide: (decision: PermissionDecision) => void;
}

/** Truncate args identically to ToolUseBadge so the visual line is bounded. */
function formatArgs(args: unknown): string | null {
  if (args === undefined) return null;
  try {
    return JSON.stringify(args).slice(0, 80);
  } catch {
    return "[unserializable]";
  }
}

export function PermissionDialog({
  tool,
  args,
  onDecide,
}: PermissionDialogProps): React.JSX.Element {
  useInput((input) => {
    // `useInput` fires for every keystroke; we only care about the three
    // decision keys. Anything else (Enter, arrows, ctrl-modifiers, etc.) is
    // discarded so the user can't accidentally approve a tool.
    if (input === "y") {
      onDecide("allow");
    } else if (input === "n") {
      onDecide("deny");
    } else if (input === "a") {
      onDecide("allow_always");
    }
  });

  const argsLine = formatArgs(args);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
      marginY={1}
    >
      <Text bold color="yellow">
        Permission required
      </Text>
      <Box>
        <Text>tool: </Text>
        <Text bold>{tool}</Text>
      </Box>
      {argsLine !== null && (
        <Box>
          <Text dimColor>args: {argsLine}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text>
          <Text color="green">[y]</Text> allow   <Text color="red">[n]</Text>{" "}
          deny   <Text color="cyan">[a]</Text> allow always
        </Text>
      </Box>
    </Box>
  );
}
