/**
 * Shared types for oh-tui.
 */

export type { SessionListEntry, ToolSpec } from "@meta-harney/bridge-client";

export interface CliArgs {
  prompt: string | null;
  provider: string | null;
  profile: string | null;
  model: string | null;
  framing: "newline" | "content-length";
  bridgeBin: string;
  bridgeArgs: string[];
  yolo: boolean;
  /**
   * When true, tool results render in full; otherwise ToolCallView truncates
   * them to the first 5 lines with a "… N more lines" suffix. Default false
   * keeps the REPL readable on tools that dump kilobytes (e.g. `bash`).
   */
  fullToolOutput: boolean;
}

export type TranscriptItemKind = "user" | "assistant" | "system" | "tool_call";

export interface ToolCallState {
  invocationId: string;
  tool: string;
  args: unknown;
  status: "running" | "done" | "error";
  result?: string;
}

export type SystemSubkind = "sessions" | "tools" | "error" | "info";

export type TranscriptItem =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "assistant";
      id: string;
      text: string;
      done: boolean;
      toolCalls: ToolCallState[];
    }
  | { kind: "system"; id: string; subkind: SystemSubkind; payload: unknown };
