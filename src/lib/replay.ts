/**
 * Convert a Message[] (as returned by `session.load`) into TranscriptItem[]
 * for display in the REPL transcript.
 *
 * The wire shape mirrors meta-harney's pydantic Message:
 *   role: "user" | "assistant" | "system" | "tool"
 *   content: ContentBlock[]   // discriminated by `type`
 *
 * ContentBlock variants this module cares about:
 *   - text          { type: "text", text: string }
 *   - tool_call     { type: "tool_call", invocation_id: string, name: string, args? }
 *     (also accept the legacy alias `tool_use` defensively)
 *   - tool_result   { type: "tool_result", invocation_id, success?, output?, error? }
 *
 * v1 limitations:
 *   - Only text blocks are rendered with full fidelity.
 *   - Tool calls are summarized as a `ToolCallState` with status "done" —
 *     we don't re-stream history through the tool layer.
 *   - Tool results are surfaced as the matching call's `result` text when we
 *     can correlate them by invocation_id; otherwise they're dropped.
 *   - "tool"-role messages are skipped (they're the structural counterpart to
 *     tool_result blocks and would render redundantly).
 *   - Replayed assistant items are marked `done: true` so the live cursor
 *     spinner stays away from historical output.
 */

import type { TranscriptItem, ToolCallState } from "../types.js";

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
      const text = extractText(blocks);
      items.push({ kind: "user", id: replayId(), text });
      continue;
    }

    if (msg.role === "assistant") {
      const text = extractText(blocks);
      const toolCalls = summarizeTools(blocks);
      items.push({
        kind: "assistant",
        id: replayId(),
        text,
        done: true,
        toolCalls,
      });
      continue;
    }

    if (msg.role === "system") {
      const text = extractText(blocks);
      items.push({
        kind: "system",
        id: replayId(),
        subkind: "info",
        payload: text,
      });
      continue;
    }

    if (msg.role === "tool") {
      // Tool messages carry tool_result blocks that we've already attributed
      // to the preceding assistant turn via summarizeTools; skip to avoid
      // duplicate rendering.
      applyToolResultsToPrevAssistant(items, blocks);
      continue;
    }

    // Unknown role — silently skip rather than throw, per defensive parsing.
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

function summarizeTools(blocks: unknown[]): ToolCallState[] {
  const calls: ToolCallState[] = [];
  let resultIndex = 0;
  for (const b of blocks) {
    if (typeof b !== "object" || b === null) continue;
    const blk = b as RawBlock;
    const type = blk.type;
    if ((type === "tool_call" || type === "tool_use") && typeof blk.name === "string") {
      const invocationId =
        typeof blk.invocation_id === "string"
          ? blk.invocation_id
          : typeof blk.invocationId === "string"
            ? blk.invocationId
            : `replay-tool-${resultIndex}`;
      calls.push({
        invocationId,
        tool: blk.name,
        args: blk.args ?? null,
        status: "done",
      });
      resultIndex += 1;
    } else if (type === "tool_result") {
      // Inline tool_result in the assistant content (rare but legal). Match it
      // back onto the most recently emitted call with the same invocation_id.
      const invocationId =
        typeof blk.invocation_id === "string"
          ? blk.invocation_id
          : typeof blk.invocationId === "string"
            ? blk.invocationId
            : null;
      if (invocationId === null) continue;
      const target = calls.find((c) => c.invocationId === invocationId);
      if (target === undefined) continue;
      applyResultToCall(target, blk);
    }
  }
  return calls;
}

function applyToolResultsToPrevAssistant(
  items: TranscriptItem[],
  blocks: unknown[],
): void {
  // Walk backwards to find the most recent assistant item with toolCalls.
  let assistant: Extract<TranscriptItem, { kind: "assistant" }> | undefined;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const it = items[i]!;
    if (it.kind === "assistant") {
      assistant = it;
      break;
    }
  }
  if (assistant === undefined) return;
  for (const b of blocks) {
    if (typeof b !== "object" || b === null) continue;
    const blk = b as RawBlock;
    if (blk.type !== "tool_result") continue;
    const invocationId =
      typeof blk.invocation_id === "string"
        ? blk.invocation_id
        : typeof blk.invocationId === "string"
          ? blk.invocationId
          : null;
    if (invocationId === null) continue;
    const call = assistant.toolCalls.find((c) => c.invocationId === invocationId);
    if (call === undefined) continue;
    applyResultToCall(call, blk);
  }
}

function applyResultToCall(call: ToolCallState, blk: RawBlock): void {
  const isError =
    blk.success === false || blk.is_error === true || typeof blk.error === "string";
  call.status = isError ? "error" : "done";
  if (typeof blk.error === "string" && blk.error.length > 0) {
    call.result = blk.error;
    return;
  }
  const out = blk.output;
  if (typeof out === "string") {
    call.result = out;
  } else if (out !== undefined && out !== null) {
    try {
      call.result = JSON.stringify(out);
    } catch {
      // ignore
    }
  }
}
