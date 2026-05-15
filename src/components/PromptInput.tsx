/**
 * PromptInput — controlled single-line input.
 *
 * After Phase 14b, App.tsx owns all editor state (value, history, picker,
 * Esc-double-tap) and PromptInput is a pure render component that wraps
 * ink-text-input. ↑/↓ history navigation lives in App.tsx's central
 * useInput handler.
 *
 * When `suppressSubmit` is true, Enter is swallowed — App.tsx is handling
 * Enter for picker selection instead.
 */

import type React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { useTheme } from "../theme/ThemeContext.js";

export interface PromptInputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  placeholder?: string;
  suppressSubmit?: boolean;
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  suppressSubmit = false,
}: PromptInputProps): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <Box>
      <Text color={theme.colors.primary}>oh&gt; </Text>
      <TextInput
        value={value}
        onChange={onChange}
        onSubmit={suppressSubmit ? () => {} : onSubmit}
        {...(placeholder !== undefined ? { placeholder } : {})}
      />
    </Box>
  );
}
