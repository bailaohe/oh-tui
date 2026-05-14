/**
 * Top-level Ink component for oh-tui.
 *
 * NOTE: This is a Task 10 stub. Real UI lands in T11+.
 */

import React from "react";
import { Box, Text } from "ink";
import type { CliArgs } from "./types.js";

export interface AppProps {
  args: CliArgs;
}

export function App({ args }: AppProps): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text>oh-tui v0.1.0 (scaffolding)</Text>
      <Text dimColor>bridge: {args.bridgeBin}</Text>
    </Box>
  );
}
