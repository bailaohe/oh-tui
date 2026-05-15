/**
 * WelcomeBanner — splash logo shown when the transcript is empty.
 *
 * Wrapped in a rounded full-width Box so the welcome card spans the terminal
 * regardless of column count (1:1 with Claude Code's welcome panel). The
 * LOGO and the hint rows live inside the border; primary-color is themed.
 */

import type React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/ThemeContext.js";
import { useTerminalWidth } from "../hooks/useTerminalWidth.js";

const LOGO: string[] = [
  "   ____  __     __        __        _ ",
  "  / __ \\/ /_   / /___  __/ /__  ___| |",
  " / / / / __ \\ / __/ / / / / _ \\/ __| |",
  "/ /_/ / / / // /_/ /_/ / /  __/ (__|_|",
  "\\____/_/ /_/(_)__/\\__,_/_/\\___/\\___(_)",
];

export interface WelcomeBannerProps {
  version: string;
}

export function WelcomeBanner({ version }: WelcomeBannerProps): React.JSX.Element {
  const { theme } = useTheme();
  const termWidth = useTerminalWidth();
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.colors.primary}
      paddingX={2}
      paddingY={1}
      marginBottom={1}
      width={Math.max(termWidth, 40)}
    >
      {LOGO.map((line, i) => (
        <Text key={i} color={theme.colors.primary} bold>
          {line}
        </Text>
      ))}
      <Text> </Text>
      <Text>
        <Text dimColor>An oh-mini-powered terminal coding agent</Text>
        <Text dimColor>{"  "}v{version}</Text>
      </Text>
      <Text> </Text>
      <Text>
        <Text color={theme.colors.primary}>/help</Text>
        <Text dimColor> commands  </Text>
        <Text dimColor>|  </Text>
        <Text color={theme.colors.primary}>/theme</Text>
        <Text dimColor> switch  </Text>
        <Text dimColor>|  </Text>
        <Text color={theme.colors.primary}>Ctrl+C</Text>
        <Text dimColor> exit</Text>
      </Text>
    </Box>
  );
}
