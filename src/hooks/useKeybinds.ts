/**
 * useKeybinds — small collection of global keyboard bindings used across
 * modes. Each hook is a thin wrapper over Ink's `useInput` so that the
 * binding's intent is named at the call site rather than buried inline.
 *
 * Currently exposes:
 *   - `useCancelBinding(onCancel)` — invokes `onCancel` when the user
 *     presses Ctrl+C. Wiring `$/cancelRequest` itself is the caller's
 *     responsibility; this hook only routes the keystroke.
 *
 * Notes:
 *   - Ink's `useInput` ignores Ctrl+C by default (it raises SIGINT instead).
 *     We don't fight that here — see the README/plan: T16 expects callers
 *     to also pass `exitOnCtrlC: false` to the Ink render so this binding
 *     can claim the keystroke. Without that, the process exits before
 *     `onCancel` fires.
 */

import { useInput } from "ink";

/**
 * Fire `onCancel` whenever the user presses Ctrl+C. Other keystrokes are
 * ignored so the binding never accidentally swallows user input.
 */
export function useCancelBinding(onCancel: () => void): void {
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      onCancel();
    }
  });
}
