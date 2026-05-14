/**
 * OneShotMode — fire-and-exit flow for `oh-tui "<prompt>"`.
 *
 * Lifecycle:
 *   1. `useBridgeClient` spawns the bridge + initializes; we wait for `ready`.
 *   2. Create a fresh session via `session.create` and remember its id.
 *   3. Send the user prompt with `session.send_message` and subscribe to the
 *      returned handle's stream events.
 *   4. Translate wire events into UI state:
 *        - `text_delta`           → append to streaming text buffer
 *        - `tool_call_started`    → push a "running" ToolUseBadge
 *        - `tool_call_completed`  → flip matching badge to "done" / "error"
 *      We accept legacy `tool_use` / `tool_result` aliases too, because the
 *      project plan template names them that way and a future protocol
 *      revision might rename engine events to match.
 *   5. When `handle.done` resolves, mark finished and schedule `app.exit()`
 *      after a short visual hold so the user sees the completed state
 *      (cursor goes away, last badge flips to ✓) before the screen tears
 *      down. The bridge subprocess is still torn down cleanly by the
 *      `useBridgeClient` unmount path.
 *
 * StrictMode: an outer ref-latch guards the send pipeline so the effect
 * doesn't fire twice in dev. (`useBridgeClient` has its own latch for the
 * subprocess; this one is for the send_message we'd otherwise duplicate.)
 */

import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Box, Text, useApp } from "ink";
import type { SendMessageHandle } from "@meta-harney/bridge-client";
import { useBridgeClient } from "../hooks/useBridgeClient.js";
import { StreamingMessage } from "../components/StreamingMessage.js";
import {
  ToolUseBadge,
  type ToolBadgeStatus,
} from "../components/ToolUseBadge.js";
import type { CliArgs } from "../types.js";

export interface OneShotModeProps {
  args: CliArgs;
}

interface ToolBadgeState {
  tool: string;
  status: ToolBadgeStatus;
  args?: unknown;
  /** Engine-supplied id used to pair started/completed events. */
  invocationId?: string;
}

/**
 * Loosely typed StreamEvent — the bridge serializes pydantic events
 * verbatim, so we duck-type the fields we actually consume.
 */
interface StreamEventLike {
  kind?: string;
  text?: string;
  // tool_call_started / tool_use variants
  tool_name?: string;
  tool?: string;
  invocation_id?: string;
  args?: unknown;
  // tool_call_completed / tool_result variants
  result?: { is_error?: boolean } | unknown;
  error?: unknown;
  is_error?: boolean;
}

const TEXT_DELTA_KINDS = new Set(["text_delta"]);
const TOOL_STARTED_KINDS = new Set(["tool_call_started", "tool_use"]);
const TOOL_COMPLETED_KINDS = new Set(["tool_call_completed", "tool_result"]);

/** Visual hold so the final frame is observable before Ink unmounts. */
const EXIT_HOLD_MS = 100;

function eventToolName(e: StreamEventLike): string {
  return e.tool_name ?? e.tool ?? "?";
}

function eventIsError(e: StreamEventLike): boolean {
  if (e.error !== undefined && e.error !== null) return true;
  if (e.is_error === true) return true;
  const result = e.result;
  if (
    result !== undefined &&
    result !== null &&
    typeof result === "object" &&
    "is_error" in (result as Record<string, unknown>)
  ) {
    return (result as { is_error?: unknown }).is_error === true;
  }
  return false;
}

export function OneShotMode({ args }: OneShotModeProps): React.JSX.Element {
  const { client, error, ready } = useBridgeClient(args);
  const [text, setText] = useState("");
  const [tools, setTools] = useState<ToolBadgeState[]>([]);
  const [finished, setFinished] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<Error | null>(null);
  const app = useApp();

  // Guard against StrictMode's double-invoke spawning two send_message flows.
  const startedRef = useRef(false);

  useEffect(() => {
    if (!ready || client === null) return;
    if (args.prompt === null || args.prompt === undefined) return;
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    let handle: SendMessageHandle | null = null;

    void (async () => {
      try {
        const summary = await client.sessionCreate();
        if (cancelled) return;
        setSessionId(summary.id);

        // `prompt` is non-null here per the early return above; assert for TS.
        const prompt = args.prompt as string;
        handle = client.sendMessage(summary.id, {
          role: "user",
          content: [{ type: "text", text: prompt }],
        });

        handle.onEvent((raw: unknown) => {
          if (raw === null || typeof raw !== "object") return;
          const ev = raw as StreamEventLike;
          const kind = ev.kind;
          if (kind === undefined) return;

          if (TEXT_DELTA_KINDS.has(kind)) {
            const chunk = typeof ev.text === "string" ? ev.text : "";
            if (chunk.length > 0) setText((t) => t + chunk);
            return;
          }

          if (TOOL_STARTED_KINDS.has(kind)) {
            // Build the entry conditionally so we don't set
            // `invocationId: undefined` under exactOptionalPropertyTypes.
            const entry: ToolBadgeState = {
              tool: eventToolName(ev),
              status: "running",
              args: ev.args,
              ...(typeof ev.invocation_id === "string"
                ? { invocationId: ev.invocation_id }
                : {}),
            };
            setTools((prev) => [...prev, entry]);
            return;
          }

          if (TOOL_COMPLETED_KINDS.has(kind)) {
            const nextStatus: ToolBadgeStatus = eventIsError(ev)
              ? "error"
              : "done";
            const invId = ev.invocation_id;
            setTools((prev) => {
              // Prefer matching by invocation_id when available; fall back to
              // the most recently added running badge so a missing id (e.g.
              // legacy `tool_use`/`tool_result` pair) still closes correctly.
              let matchIdx = -1;
              if (invId !== undefined) {
                matchIdx = prev.findIndex(
                  (t) => t.invocationId === invId && t.status === "running",
                );
              }
              if (matchIdx === -1) {
                for (let i = prev.length - 1; i >= 0; i--) {
                  const candidate = prev[i];
                  if (candidate !== undefined && candidate.status === "running") {
                    matchIdx = i;
                    break;
                  }
                }
              }
              if (matchIdx === -1) return prev;
              return prev.map((t, i) =>
                i === matchIdx ? { ...t, status: nextStatus } : t,
              );
            });
            return;
          }
          // Unknown kinds (thinking_delta, iteration_completed,
          // turn_completed, ...) are ignored at this layer — they don't
          // contribute to the one-shot UI.
        });

        await handle.done;
        if (cancelled) return;
        setFinished(true);
        // Hold the final frame briefly so the user can read it before exit.
        setTimeout(() => {
          if (!cancelled) app.exit();
        }, EXIT_HOLD_MS);
      } catch (e) {
        if (cancelled) return;
        setRuntimeError(e as Error);
        // Give the error one frame to paint, then bail.
        setTimeout(() => {
          if (!cancelled) app.exit();
        }, EXIT_HOLD_MS);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Effect intentionally fires once after the bridge is ready. Re-running
    // on every render would re-send the prompt; downstream consumers should
    // remount via `key` if they need to retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, client]);

  if (error !== null) {
    return <Text color="red">error: {error.message}</Text>;
  }
  if (runtimeError !== null) {
    return <Text color="red">error: {runtimeError.message}</Text>;
  }
  if (!ready) {
    return <Text dimColor>connecting…</Text>;
  }

  const promptDisplay = args.prompt ?? "";
  const sessionDisplay =
    sessionId !== null ? `${sessionId.slice(0, 8)}…` : null;

  return (
    <Box flexDirection="column">
      {sessionDisplay !== null && (
        <Text dimColor>session: {sessionDisplay}</Text>
      )}
      <Text dimColor>{`> ${promptDisplay}`}</Text>
      <Box flexDirection="column">
        {tools.map((t, i) => (
          <ToolUseBadge
            key={t.invocationId ?? `idx-${i}`}
            tool={t.tool}
            status={t.status}
            args={t.args}
          />
        ))}
        <StreamingMessage text={text} finished={finished} />
      </Box>
    </Box>
  );
}
