/**
 * REPL mode: interactive multi-turn chat.
 *
 * NOTE: Task 11 stub. Real implementation lands in T15.
 */

import type React from "react";
import { Box, Text } from "ink";
import type { CliArgs } from "../types.js";

export interface ReplModeProps {
  args: CliArgs;
}

export function ReplMode({ args }: ReplModeProps): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text>REPL mode (TODO)</Text>
      <Text dimColor>bridge: {args.bridgeBin}</Text>
    </Box>
  );
}
