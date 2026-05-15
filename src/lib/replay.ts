/**
 * Convert a Message[] (as returned by `session.load`) into TranscriptItem[].
 *
 * After the Phase 14a model refresh, tool_call and tool_result blocks become
 * top-level rows linked by invocationId, rather than nested under an
 * assistant row's toolCalls array.
 *
 * Wire shape (mirrors meta-harney pydantic Message):
 *   role: "user" | "assistant" | "system" | "tool"
 *   content: ContentBlock[]   // discriminated by `type`
 *
 * ContentBlock variants:
 *   - text          { type: "text", text }
 *   - tool_call     { type: "tool_call", invocation_id, name, args? }
 *     (legacy alias `tool_use` accepted)
 *   - tool_result   { type: "tool_result", invocation_id, success?, output?, error? }
 *
 * v1 limitations:
 *   - Only text blocks render with full fidelity on assistant rows.
 *   - Replayed assistant items mark done: true (no streaming cursor).
 *   - "tool"-role messages walk their content blocks for tool_result entries
 *     and push them as top-level rows in order.
 */

import type { TranscriptItem } from "../types.js";

interface RawMessage {
  role?: unknown;
  content?: unknown;
}

interface RawBlock {
  type?: unknown;
  text?: unknown;
  name?: unknown;
  invocation_id?: unknown;
  invocationId?: unknown;
  args?: unknown;
  output?: unknown;
  error?: unknown;
  success?: unknown;
  is_error?: unknown;
}

let _replayCounter = 0;
function replayId(): string {
  _replayCounter += 1;
  return `replay-${_replayCounter}`;
}

export function messagesToTranscript(messages: unknown): TranscriptItem[] {
  if (!Array.isArray(messages)) return [];
  const items: TranscriptItem[] = [];

  for (const m of messages) {
    if (typeof m !== "object" || m === null) continue;
    const msg = m as RawMessage;
    if (!Array.isArray(msg.content)) continue;
    const blocks = msg.content as unknown[];

    if (msg.role === "user") {
      items.push({
        id: replayId(),
        role: "user",
        text: extractText(blocks),
      });
      continue;
    }

    if (msg.role === "assistant") {
      const text = extractText(blocks);
      // Push the assistant text first (if any), then tool_calls / tool_results
      // in source order as top-level rows.
      if (text.length > 0) {
        items.push({
          id: replayId(),
          role: "assistant",
          text,
          done: true,
        });
      }
      for (const b of blocks) {
        if (typeof b !== "object" || b === null) continue;
        const blk = b as RawBlock;
        const type = blk.type;
        if ((type === "tool_call" || type === "tool_use") && typeof blk.name === "string") {
          items.push({
            id: replayId(),
            role: "tool",
            text: "",
            toolName: blk.name,
            toolInput: blk.args ?? null,
            invocationId: invocationIdOf(blk) ?? replayId(),
          });
        } else if (type === "tool_result") {
          const invocationId = invocationIdOf(blk);
          if (invocationId === undefined) continue;
          items.push({
            id: replayId(),
            role: "tool_result",
            text: resultTextOf(blk),
            invocationId,
            isError: isErrorOf(blk),
          });
        }
      }
      continue;
    }

    if (msg.role === "system") {
      items.push({
        id: replayId(),
        role: "system",
        subkind: "info",
        payload: extractText(blocks),
        text: extractText(blocks),
      });
      continue;
    }

    if (msg.role === "tool") {
      // tool-role messages carry tool_result blocks. Push each as a top-level
      // tool_result row, in order.
      for (const b of blocks) {
        if (typeof b !== "object" || b === null) continue;
        const blk = b as RawBlock;
        if (blk.type !== "tool_result") continue;
        const invocationId = invocationIdOf(blk);
        if (invocationId === undefined) continue;
        items.push({
          id: replayId(),
          role: "tool_result",
          text: resultTextOf(blk),
          invocationId,
          isError: isErrorOf(blk),
        });
      }
      continue;
    }

    // Unknown roles: skip silently.
  }

  return items;
}

function extractText(blocks: unknown[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (typeof b !== "object" || b === null) continue;
    const blk = b as RawBlock;
    if (blk.type === "text" && typeof blk.text === "string") {
      parts.push(blk.text);
    }
  }
  return parts.join("");
}

function invocationIdOf(blk: RawBlock): string | undefined {
  if (typeof blk.invocation_id === "string" && blk.invocation_id.length > 0) {
    return blk.invocation_id;
  }
  if (typeof blk.invocationId === "string" && blk.invocationId.length > 0) {
    return blk.invocationId;
  }
  return undefined;
}

function isErrorOf(blk: RawBlock): boolean {
  if (blk.success === false) return true;
  if (blk.is_error === true) return true;
  if (typeof blk.error === "string" && blk.error.length > 0) return true;
  return false;
}

function resultTextOf(blk: RawBlock): string {
  if (typeof blk.error === "string" && blk.error.length > 0) {
    return blk.error;
  }
  const out = blk.output;
  if (typeof out === "string") return out;
  if (out !== undefined && out !== null) {
    try {
      return JSON.stringify(out);
    } catch {
      return "";
    }
  }
  return "";
}
