/**
 * SelectModal — generic arrow-key picker rendered in a bordered box.
 *
 * Used for any one-shot single-choice prompt in the TUI (session picker,
 * model picker, etc.). The component is fully controlled by keyboard:
 *   - ↑/↓ navigate (wraps at both ends)
 *   - Enter confirms the highlighted option (invokes `onSelect(value)`)
 *   - Esc cancels (invokes `onCancel`)
 *
 * `useInput` is registered unconditionally on every render so the hook
 * order stays stable — never gate it behind an early return.
 */

import type React from "react";
import { useRef, useState } from "react";
import { Box, Text, useInput } from "ink";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

export interface SelectModalProps {
  title: string;
  options: SelectOption[];
  initialIndex?: number;
  onSelect: (value: string) => void;
  onCancel: () => void;
}

export function SelectModal({
  title,
  options,
  initialIndex = 0,
  onSelect,
  onCancel,
}: SelectModalProps): React.JSX.Element {
  const [idx, setIdx] = useState(initialIndex);
  // Mirror `idx` in a ref so `return` reads the latest value even when
  // multiple keys arrive in the same tick (state updates are batched).
  const idxRef = useRef(idx);
  idxRef.current = idx;

  useInput((_input, key) => {
    if (key.upArrow) {
      setIdx((i) => {
        const next = i > 0 ? i - 1 : options.length - 1;
        idxRef.current = next;
        return next;
      });
    } else if (key.downArrow) {
      setIdx((i) => {
        const next = i < options.length - 1 ? i + 1 : 0;
        idxRef.current = next;
        return next;
      });
    } else if (key.return) {
      const choice = options[idxRef.current];
      if (choice !== undefined) onSelect(choice.value);
    } else if (key.escape) {
      onCancel();
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      marginY={1}
    >
      <Text bold>{title}</Text>
      <Box flexDirection="column" marginTop={1}>
        {options.map((opt, i) => {
          const active = i === idx;
          return (
            <Box key={opt.value}>
              {active ? (
                <Text color="cyan">▸ </Text>
              ) : (
                <Text>  </Text>
              )}
              <Text bold={active}>{opt.label}</Text>
              {opt.hint !== undefined && <Text dimColor>  {opt.hint}</Text>}
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate · enter select · esc cancel</Text>
      </Box>
    </Box>
  );
}
