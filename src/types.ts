/**
 * Shared types for oh-tui.
 */

export type { SessionListEntry, ToolSpec } from "@meta-harney/bridge-client";

export interface CliArgs {
  prompt: string | null;
  exitOnDone: boolean;
  theme: string;
  provider: string | null;
  profile: string | null;
  model: string | null;
  framing: "newline" | "content-length";
  bridgeBin: string;
  bridgeArgs: string[];
  yolo: boolean;
  /**
   * When true, tool results render in full; otherwise ToolCallDisplay truncates
   * them. Default false keeps the REPL readable on tools that dump kilobytes.
   */
  fullToolOutput: boolean;
}

export type TranscriptRole =
  | "system"
  | "user"
  | "assistant"
  | "thinking"
  | "tool"
  | "tool_result";

export type SystemSubkind = "sessions" | "tools" | "error" | "info";

/**
 * Flat transcript item. `tool` and `tool_result` are top-level rows that
 * carry an `invocationId` for adjacent-pair grouping in ConversationView.
 */
export interface TranscriptItem {
  id: string;
  role: TranscriptRole;
  text: string;

  // role === "assistant"
  done?: boolean;

  // role === "tool" | "tool_result"
  toolName?: string;
  toolInput?: unknown;
  invocationId?: string;
  isError?: boolean;

  // role === "system"
  subkind?: SystemSubkind;
  payload?: unknown;
}
