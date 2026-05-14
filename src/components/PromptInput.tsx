/**
 * PromptInput — single-line editable input for the REPL.
 *
 * Renders a cyan `oh> ` prefix followed by an `ink-text-input` field. On
 * Enter, the current value is handed to the parent via `onSubmit` and the
 * buffer is cleared. The component is otherwise stateless about session /
 * history concerns — the parent (ReplMode) owns scrollback and routes
 * submitted prompts to the bridge.
 *
 * History (up/down recall) is intentionally **not** wired in this iteration:
 * `ink-text-input` consumes arrow keys for in-line cursor movement, so
 * shell-style history navigation would need a custom input layer. The
 * `history` prop is plumbed through so callers don't have to refactor when
 * we add that, and so the array itself is accessible if we later swap in
 * an UncontrolledTextInput / raw `useInput` variant.
 */

import type React from "react";
import { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export interface PromptInputProps {
  /** Past prompts in submission order. Reserved for future ↑/↓ recall. */
  history: string[];
  /** Invoked with the prompt text when the user presses Enter. */
  onSubmit: (text: string) => void;
}

export function PromptInput({
  history,
  onSubmit,
}: PromptInputProps): React.JSX.Element {
  const [value, setValue] = useState("");

  // `history` is accepted for forward-compat (see file-level note). Touch
  // its length so noUnusedParameters doesn't flag the prop and so a future
  // recall implementation has a stable reference point.
  void history.length;

  return (
    <Box>
      <Text color="cyan">oh&gt; </Text>
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={(submitted) => {
          // Clear the buffer *before* notifying the parent so that if the
          // parent triggers a synchronous re-render (e.g. pushing a turn
          // into scrollback) we don't briefly flash the old value.
          setValue("");
          onSubmit(submitted);
        }}
      />
    </Box>
  );
}
