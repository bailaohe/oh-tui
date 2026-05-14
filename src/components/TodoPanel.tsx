/**
 * TodoPanel — render an assistant `todo_write` tool invocation as a plan.
 *
 * The bridge surfaces `todo_write` as a regular tool call whose `args` carry
 * the structured plan (a `todos: TodoItem[]`). We intercept those in
 * TranscriptItemView and render them via this panel instead of the generic
 * ToolCallView so the user sees a stable plan-of-record block instead of
 * raw JSON.
 *
 * Status visuals encode progress:
 *   - pending     → ○ dim gray
 *   - in_progress → ◐ yellow
 *   - completed   → ● green, strikethrough + dim
 *
 * `parseTodos` is exported so TranscriptItemView can defensively fall back to
 * ToolCallView when args don't match the expected shape (e.g. tool renamed,
 * malformed payload, partial streaming state).
 */

import type React from "react";
import { Box, Text } from "ink";

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface TodoPanelProps {
  todos: TodoItem[];
}

const ICON: Record<TodoItem["status"], string> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
};

const COLOR: Record<TodoItem["status"], "gray" | "yellow" | "green"> = {
  pending: "gray",
  in_progress: "yellow",
  completed: "green",
};

export function TodoPanel({ todos }: TodoPanelProps): React.JSX.Element {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      paddingX={1}
      marginY={1}
    >
      <Text bold>plan</Text>
      {todos.map((t, i) => (
        <Box key={i}>
          <Text color={COLOR[t.status]}>{ICON[t.status]} </Text>
          <Text
            dimColor={t.status === "completed"}
            strikethrough={t.status === "completed"}
          >
            {t.content}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

/**
 * Defensive parser for the `todo_write` tool's `args` payload.
 *
 * Returns null when the shape doesn't match — callers should fall through to
 * the generic ToolCallView in that case so the user still sees *something*
 * instead of a silently-dropped tool call. Empty `todos` arrays also return
 * null so we don't render an empty plan box.
 */
export function parseTodos(args: unknown): TodoItem[] | null {
  if (typeof args !== "object" || args === null) return null;
  const todos = (args as { todos?: unknown }).todos;
  if (!Array.isArray(todos)) return null;
  const out: TodoItem[] = [];
  for (const t of todos) {
    if (typeof t !== "object" || t === null) continue;
    const item = t as { content?: unknown; status?: unknown };
    if (typeof item.content !== "string") continue;
    const status = item.status;
    if (
      status !== "pending" &&
      status !== "in_progress" &&
      status !== "completed"
    ) {
      continue;
    }
    out.push({ content: item.content, status });
  }
  return out.length > 0 ? out : null;
}
