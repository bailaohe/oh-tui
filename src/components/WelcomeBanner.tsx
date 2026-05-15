/**
 * WelcomeBanner — splash logo shown when the transcript is empty.
 *
 * Rendered by ConversationView only when items.length === 0 && ready.
 * Theme provides the LOGO color; version flows through from package.json
 * via the App component (constant inlined at build time / startup).
 */

import type React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/ThemeContext.js";

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
  return (
    <Box flexDirection="column" marginBottom={1}>
      {LOGO.map((line, i) => (
        <Text key={i} color={theme.colors.primary} bold>
          {line}
        </Text>
      ))}
      <Text> </Text>
      <Text>
        <Text dimColor> An oh-mini-powered terminal coding agent</Text>
        <Text dimColor>{"  "}v{version}</Text>
      </Text>
      <Text> </Text>
      <Text>
        <Text dimColor> </Text>
        <Text color={theme.colors.primary}>/help</Text>
        <Text dimColor> commands  |  </Text>
        <Text color={theme.colors.primary}>/theme</Text>
        <Text dimColor> switch (14b)  |  </Text>
        <Text color={theme.colors.primary}>Ctrl+C</Text>
        <Text dimColor> exit</Text>
      </Text>
    </Box>
  );
}
