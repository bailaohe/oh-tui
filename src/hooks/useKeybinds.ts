/**
 * useKeybinds — small collection of global keyboard bindings used across
 * modes. Each hook is a thin wrapper over Ink's `useInput` so that the
 * binding's intent is named at the call site rather than buried inline.
 *
 * Exposes:
 *   - `useCancelBinding(onCancel)` — fire `onCancel` on every Ctrl+C.
 *     Cancel-only, no exit dance. Used by OneShotMode which always has at
 *     most one inflight request and exits when that request finishes.
 *   - `useCancelOrExit({ getInflight, onExit, onHint?, windowMs })` — REPL
 *     semantics: cancel if a request is inflight, otherwise require a
 *     double-tap of Ctrl+C within `windowMs` to exit (so a single accidental
 *     stroke doesn't kill the session).
 *
 * Notes:
 *   - Ink's `useInput` ignores Ctrl+C by default (it raises SIGINT instead).
 *     Callers must pass `exitOnCtrlC: false` to the Ink render so this
 *     binding can claim the keystroke. Without that, the process exits
 *     before `onCancel` / `onExit` fires.
 */

import { useRef } from "react";
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

export interface CancelOrExitOptions {
  /**
   * Returns the currently inflight cancellable handle, or `null` if nothing
   * is running. When non-null, Ctrl+C calls `handle.cancel()` instead of
   * progressing the exit dance.
   */
  getInflight: () => { cancel: () => Promise<void> } | null;
  /** Called when the user confirms exit with a second Ctrl+C in-window. */
  onExit: () => void;
  /**
   * Optional visibility callback for the "press Ctrl+C again to exit" hint.
   * Receives `true` on the first tap and `false` when the window expires or
   * exit fires.
   */
  onHint?: (visible: boolean) => void;
  /** Window in milliseconds within which the second tap must arrive. */
  windowMs?: number;
}

/**
 * REPL Ctrl+C handler: cancel inflight, or arm/confirm exit on idle.
 *
 *   - If `getInflight()` returns a handle, we invoke its `cancel()` and stop.
 *     `.cancel()` may reject (e.g. the bridge already finished) — we swallow
 *     that so a benign race doesn't crash the UI.
 *   - Otherwise on the first tap: record the timestamp + show the hint, then
 *     start a timer to clear both after `windowMs`.
 *   - A second tap inside the window clears state and calls `onExit()`.
 */
export function useCancelOrExit(opts: CancelOrExitOptions): void {
  const { getInflight, onExit, onHint, windowMs = 2000 } = opts;
  const lastTapRef = useRef(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useInput((input, key) => {
    if (!(key.ctrl && input === "c")) return;

    const handle = getInflight();
    if (handle !== null) {
      // Race with normal completion is benign — swallow.
      handle.cancel().catch(() => {
        /* ignore */
      });
      return;
    }

    const now = Date.now();
    if (lastTapRef.current !== 0 && now - lastTapRef.current <= windowMs) {
      // Second tap in-window — exit.
      lastTapRef.current = 0;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      onHint?.(false);
      onExit();
      return;
    }

    // First tap — arm the exit and show the hint.
    lastTapRef.current = now;
    onHint?.(true);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      lastTapRef.current = 0;
      timerRef.current = null;
      onHint?.(false);
    }, windowMs);
  });
}
