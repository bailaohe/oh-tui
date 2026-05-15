/**
 * useTranscript — owns the chronological scrollback.
 *
 * Items are flat rows with a `role` field. Tool calls and tool results are
 * top-level rows linked by `invocationId`; ConversationView pairs them in
 * the renderer rather than nesting them on an assistant item.
 *
 * Each item has a stable string `id` so React + Ink's <Static> can dedupe
 * completed entries.
 */

import { useCallback, useRef, useState } from "react";
import type {
  SystemSubkind,
  TranscriptItem,
} from "../types.js";

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
    setItems((prev) => [
      ...prev,
      { id, role: "user", text },
    ]);
    return id;
  }, []);

  const appendAssistant = useCallback((): string => {
    const id = nextId();
    setItems((prev) => [
      ...prev,
      { id, role: "assistant", text: "", done: false },
    ]);
    return id;
  }, []);

  const appendToken = useCallback((assistantId: string, chunk: string): void => {
    if (chunk.length === 0) return;
    setItems((prev) =>
      prev.map((item) =>
        item.role === "assistant" && item.id === assistantId
          ? { ...item, text: item.text + chunk }
          : item,
      ),
    );
  }, []);

  const finishAssistant = useCallback((assistantId: string): void => {
    setItems((prev) =>
      prev.map((item) =>
        item.role === "assistant" && item.id === assistantId
          ? { ...item, done: true }
          : item,
      ),
    );
  }, []);

  const appendTool = useCallback(
    (invocationId: string, toolName: string, toolInput: unknown): string => {
      const id = nextId();
      setItems((prev) => [
        ...prev,
        {
          id,
          role: "tool",
          text: "",
          toolName,
          toolInput,
          invocationId,
        },
      ]);
      return id;
    },
    [],
  );

  const appendToolResult = useCallback(
    (invocationId: string, text: string, isError: boolean): string => {
      const id = nextId();
      setItems((prev) => [
        ...prev,
        {
          id,
          role: "tool_result",
          text,
          invocationId,
          isError,
        },
      ]);
      return id;
    },
    [],
  );

  const appendSystem = useCallback(
    (subkind: SystemSubkind, payload: unknown): string => {
      const id = nextId();
      const text = typeof payload === "string" ? payload : "";
      setItems((prev) => [
        ...prev,
        { id, role: "system", text, subkind, payload },
      ]);
      return id;
    },
    [],
  );

  /**
   * Replace the entire transcript. Used by /resume.
   */
  const replayMessages = useCallback((next: TranscriptItem[]): void => {
    setItems(next);
  }, []);

  const clear = useCallback((): void => {
    setItems([]);
  }, []);

  // Legacy shims kept until ReplMode/OneShotMode/TranscriptItemView are
  // deleted in T10. These are no-ops on the new flat model.
  const appendToolCall = useCallback(
    (_assistantId: string, _call: unknown): void => {},
    [],
  );
  const updateToolCall = useCallback(
    (_assistantId: string, _invocationId: string, _patch: unknown): void => {},
    [],
  );

  return {
    items,
    itemsRef,
    appendUser,
    appendAssistant,
    appendToken,
    finishAssistant,
    appendTool,
    appendToolResult,
    appendSystem,
    replayMessages,
    clear,
    appendToolCall,
    updateToolCall,
  };
}

export type TranscriptApi = ReturnType<typeof useTranscript>;
