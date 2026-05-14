/**
 * PromptInput — single-line editable input for the REPL with ↑/↓ history.
 *
 * Renders a cyan `oh> ` prefix followed by an `ink-text-input` field. On
 * Enter, the current value is handed to the parent via `onSubmit` and the
 * buffer is cleared. The parent owns the `history` array (past prompts in
 * submission order) and threads it back in via the prop.
 *
 * History navigation semantics:
 *   - `historyIdx === history.length` means "at draft" (user's current input).
 *   - ↑ moves backwards through history; when we leave the draft slot, the
 *     current `value` is saved into `draft` so we can restore it later.
 *   - ↓ past the last item restores `draft`.
 *   - Editing (via `onChange`) while inside history snaps `historyIdx` back to
 *     the draft slot — feels natural: as soon as you tweak a recalled prompt,
 *     it becomes "your draft" and a subsequent ↓ won't blow it away.
 *
 * Ink dispatch order matters here: `useInput` handlers run BEFORE keystrokes
 * are delegated to children, so our ↑/↓ interception fires before
 * `ink-text-input` would otherwise consume the arrows for in-line cursor
 * movement.
 */

import type React from "react";
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

export interface PromptInputProps {
  /** Past prompts in submission order. Used for ↑/↓ recall. */
  history: string[];
  /** Invoked with the prompt text when the user presses Enter. */
  onSubmit: (text: string) => void;
  /** Optional placeholder shown when the input is empty. */
  placeholder?: string;
}

export function PromptInput({
  history,
  onSubmit,
  placeholder,
}: PromptInputProps): React.JSX.Element {
  const [value, setValue] = useState("");
  const [historyIdx, setHistoryIdx] = useState(history.length);
  const [draft, setDraft] = useState("");

  useInput((_input, key) => {
    if (key.upArrow) {
      if (history.length === 0) return;
      const newIdx = Math.max(0, historyIdx - 1);
      if (newIdx === historyIdx) return;
      // Entering history from the draft slot — preserve current input.
      if (historyIdx === history.length) setDraft(value);
      setHistoryIdx(newIdx);
      setValue(history[newIdx] ?? "");
    } else if (key.downArrow) {
      if (historyIdx === history.length) return;
      const newIdx = historyIdx + 1;
      setHistoryIdx(newIdx);
      if (newIdx === history.length) {
        setValue(draft);
      } else {
        setValue(history[newIdx] ?? "");
      }
    }
  });

  return (
    <Box>
      <Text color="cyan">oh&gt; </Text>
      <TextInput
        value={value}
        onChange={(v) => {
          setValue(v);
          // Any direct edit moves us back to the draft slot at the end of the
          // history list — that's where the new entry will conceptually land.
          if (historyIdx !== history.length) setHistoryIdx(history.length);
        }}
        onSubmit={(submitted) => {
          // Clear the buffer *before* notifying the parent so that if the
          // parent triggers a synchronous re-render (e.g. pushing a turn into
          // scrollback) we don't briefly flash the old value.
          setValue("");
          setDraft("");
          // After submit the parent will likely push `submitted` onto the
          // history array, growing its length by one. Setting the index to
          // `history.length + 1` keeps us at the new draft slot on the next
          // render. (If the parent doesn't push, the next edit will snap us
          // back via the onChange branch above.)
          setHistoryIdx(history.length + 1);
          onSubmit(submitted);
        }}
        {...(placeholder !== undefined ? { placeholder } : {})}
      />
    </Box>
  );
}
