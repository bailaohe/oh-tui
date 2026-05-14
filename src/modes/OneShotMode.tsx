/**
 * One-shot mode: run a single prompt non-interactively and exit.
 *
 * NOTE: Task 11 stub. Real implementation lands in T13.
 */

import type React from "react";
import { Box, Text } from "ink";
import type { CliArgs } from "../types.js";

export interface OneShotModeProps {
  args: CliArgs;
}

export function OneShotMode({ args }: OneShotModeProps): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text>One-shot mode (TODO)</Text>
      <Text dimColor>prompt: {args.prompt ?? "(none)"}</Text>
    </Box>
  );
}
