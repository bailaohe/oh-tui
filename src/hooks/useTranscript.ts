/**
 * useTranscript — owns the chronological scrollback for a mode.
 *
 * The transcript is a tagged union of items (user prompts, assistant turns,
 * system blocks). Each item has a stable string `id` so React + Ink's
 * <Static> can dedupe completed entries and avoid re-rendering them on every
 * token of an in-flight assistant turn.
 */

import { useCallback, useRef, useState } from "react";
import type { TranscriptItem, ToolCallState, SystemSubkind } from "../types.js";

let _idCounter = 0;
function nextId(): string {
  _idCounter += 1;
  return `t${_idCounter}`;
}

export function useTranscript() {
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const itemsRef = useRef<TranscriptItem[]>(items);
  itemsRef.current = items;

  const appendUser = useCallback((text: string): string => {
    const id = nextId();
    setItems((prev) => [...prev, { kind: "user", id, text }]);
    return id;
  }, []);

  const appendAssistant = useCallback((): string => {
    const id = nextId();
    setItems((prev) => [
      ...prev,
      { kind: "assistant", id, text: "", done: false, toolCalls: [] },
    ]);
    return id;
  }, []);

  const appendToken = useCallback((id: string, chunk: string): void => {
    if (chunk.length === 0) return;
    setItems((prev) =>
      prev.map((item) =>
        item.kind === "assistant" && item.id === id
          ? { ...item, text: item.text + chunk }
          : item,
      ),
    );
  }, []);

  const appendToolCall = useCallback(
    (id: string, call: ToolCallState): void => {
      setItems((prev) =>
        prev.map((item) =>
          item.kind === "assistant" && item.id === id
            ? { ...item, toolCalls: [...item.toolCalls, call] }
            : item,
        ),
      );
    },
    [],
  );

  const updateToolCall = useCallback(
    (id: string, invocationId: string, patch: Partial<ToolCallState>): void => {
      setItems((prev) =>
        prev.map((item) => {
          if (item.kind !== "assistant" || item.id !== id) return item;
          return {
            ...item,
            toolCalls: item.toolCalls.map((c) =>
              c.invocationId === invocationId ? { ...c, ...patch } : c,
            ),
          };
        }),
      );
    },
    [],
  );

  const finishAssistant = useCallback((id: string): void => {
    setItems((prev) =>
      prev.map((item) =>
        item.kind === "assistant" && item.id === id
          ? { ...item, done: true }
          : item,
      ),
    );
  }, []);

  const appendSystem = useCallback(
    (subkind: SystemSubkind, payload: unknown): string => {
      const id = nextId();
      setItems((prev) => [...prev, { kind: "system", id, subkind, payload }]);
      return id;
    },
    [],
  );

  /**
   * Replace the entire transcript with a pre-built list of items. Used when
   * resuming a session: messagesToTranscript() produces the historical view
   * and we drop it in wholesale so the next live turn appends as usual.
   */
  const replayMessages = useCallback((next: TranscriptItem[]): void => {
    setItems(next);
  }, []);

  const clear = useCallback((): void => {
    setItems([]);
  }, []);

  return {
    items,
    itemsRef,
    appendUser,
    appendAssistant,
    appendToken,
    appendToolCall,
    updateToolCall,
    finishAssistant,
    appendSystem,
    replayMessages,
    clear,
  };
}
