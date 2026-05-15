/**
 * CommandPicker — floating slash-command suggestion menu rendered above the
 * prompt input. Driven entirely by props; App.tsx owns the hints + selected
 * index, this component is a pure view.
 *
 * Renders null when hints is empty so callers can mount unconditionally and
 * let the prop drive visibility.
 */

import type React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/ThemeContext.js";

export interface CommandPickerProps {
  hints: string[];
  selectedIndex: number;
}

export function CommandPicker({
  hints,
  selectedIndex,
}: CommandPickerProps): React.JSX.Element | null {
  const { theme } = useTheme();
  if (hints.length === 0) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.colors.primary}
      paddingX={1}
      marginBottom={0}
    >
      <Text dimColor bold> Commands</Text>
      {hints.map((hint, i) => {
        const isSelected = i === selectedIndex;
        return (
          <Box key={hint}>
            {isSelected ? (
              <Text color={theme.colors.primary} bold>
                ❯ {hint}
              </Text>
            ) : (
              <Text>  {hint}</Text>
            )}
            {isSelected && <Text dimColor> [enter]</Text>}
          </Box>
        );
      })}
      <Text dimColor> ↑↓ navigate  ⏎ select  esc dismiss</Text>
    </Box>
  );
}
