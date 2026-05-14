/**
 * ReplMode — interactive multi-turn chat (Phase 12 rewrite).
 *
 * Key behavior changes vs Phase 11:
 *   - All scrollback (user prompts, assistant responses, /sessions and /tools
 *     output, errors) flows through a single transcript array. Completed items
 *     render inside Ink's <Static>, so high-frequency `text_delta` updates
 *     only re-render the currently-streaming assistant turn.
 *   - /sessions and /tools append SYSTEM transcript items instead of being
 *     fixed side panels — they scroll naturally with the conversation, which
 *     fixes the panel-overlap bug.
 *   - A <Spinner> appears between submit and the first `text_delta`.
 *   - Ctrl+C cancels an inflight turn; when idle, a second tap within 2s
 *     exits (via `useCancelOrExit`). The hint surfaces on the StatusBar's
 *     right side as "press Ctrl+C again to exit".
 *   - <StatusBar> at the bottom shows provider/model/short session id/yolo
 *     plus the most recent telemetry pulse.
 *
 * Streaming/active turn semantics:
 *   The id of the currently-streaming assistant item is stashed in
 *   `activeAssistantIdRef`. While streaming, that item is rendered DYNAMICALLY
 *   below the <Static> block. Once `finishAssistant` flips `done=true` and the
 *   ref clears, the item is folded back into the Static set on the next
 *   render (Static appends are append-only across renders, which is exactly
 *   what Ink documents).
 */

import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Static, Text, useApp } from "ink";
import {
  BridgeCancelled,
  type PermissionDecision,
  type SendMessageHandle,
} from "@meta-harney/bridge-client";
import { useBridgeClient } from "../hooks/useBridgeClient.js";
import { useCancelOrExit } from "../hooks/useKeybinds.js";
import { useTranscript } from "../hooks/useTranscript.js";
import { PromptInput } from "../components/PromptInput.js";
import { PermissionDialog } from "../components/PermissionDialog.js";
import { Spinner } from "../components/Spinner.js";
import { StatusBar } from "../components/StatusBar.js";
import { TranscriptItemView } from "../components/TranscriptItemView.js";
import type { CliArgs, TranscriptItem, ToolCallState } from "../types.js";

export interface ReplModeProps {
  args: CliArgs;
}

interface PendingPermission {
  tool: string;
  args: unknown;
  resolve: (decision: PermissionDecision) => void;
}

/**
 * Loosely typed StreamEvent — duck-typed because the bridge serializes
 * pydantic events verbatim and we only consume a handful of fields. We accept
 * both the canonical engine event names (`tool_call_started`, `tool_call_completed`)
 * and their legacy aliases (`tool_use`, `tool_result`).
 */
interface StreamEventLike {
  kind?: string;
  text?: string;
  tool?: string;
  tool_name?: string;
  invocation_id?: string;
  invocationId?: string;
  args?: unknown;
  result?: unknown;
  error?: unknown;
  is_error?: boolean;
}

function eventToolName(e: StreamEventLike): string {
  return e.tool_name ?? e.tool ?? "tool";
}

function eventInvocationId(e: StreamEventLike): string | undefined {
  return e.invocationId ?? e.invocation_id;
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

function eventResultText(e: StreamEventLike): string | undefined {
  const r = e.result;
  if (typeof r === "string") return r;
  if (r !== undefined && r !== null && typeof r === "object") {
    try {
      return JSON.stringify(r);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function ReplMode({ args }: ReplModeProps): React.JSX.Element {
  const { client, ready, error } = useBridgeClient(args);
  const transcript = useTranscript();
  const [history, setHistory] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [permission, setPermission] = useState<PendingPermission | null>(null);
  const [runtimeError, setRuntimeError] = useState<Error | null>(null);
  const [telemetry, setTelemetry] = useState<{
    event_type: string;
    elapsed_ms: number;
  } | null>(null);
  const [waitingForFirstToken, setWaitingForFirstToken] = useState(false);
  const [exitHintVisible, setExitHintVisible] = useState(false);
  // Force a re-render whenever the active turn switches in/out so the
  // Static/dynamic split below updates without waiting for an unrelated state
  // bump. Bumping `activeBump` is purely a re-render trigger.
  const [, setActiveBump] = useState(0);

  // Live send handle for cancellation. Ref so Ctrl+C always targets the
  // freshest value without forcing a re-render on every send/finish.
  const handleRef = useRef<SendMessageHandle | null>(null);
  // Id of the assistant transcript item currently streaming, or null when no
  // turn is in flight. We render this item dynamically; everything else goes
  // through <Static>.
  const activeAssistantIdRef = useRef<string | null>(null);
  const app = useApp();

  // Subscribe to bridge telemetry once the client is up. We register the
  // local sink first (so events that arrive between RPC send and ack aren't
  // dropped), then fire-and-forget the subscribe call.
  useEffect(() => {
    if (client === null) return;
    client.onTelemetry((ev) => {
      const payload = ev.payload as { duration_ms?: number } | null;
      const elapsed =
        payload !== null && typeof payload.duration_ms === "number"
          ? payload.duration_ms
          : 0;
      setTelemetry({
        event_type: ev.event_type,
        elapsed_ms: Math.round(elapsed),
      });
    });
    void client.telemetrySubscribe(true).catch(() => {
      // Non-fatal — the StatusBar just stays at "idle" until the user retries.
    });
  }, [client]);

  useCancelOrExit({
    getInflight: () => handleRef.current,
    onExit: () => app.exit(),
    onHint: setExitHintVisible,
  });

  const submit = useCallback(
    (prompt: string): void => {
      if (client === null) return;
      // Slash commands handled before any session work so we can /exit even
      // before the first message creates a session.
      if (prompt === "/exit" || prompt === "/quit") {
        app.exit();
        return;
      }
      if (prompt === "/sessions") {
        void (async () => {
          try {
            const list = await client.sessionList();
            transcript.appendSystem("sessions", list);
          } catch (e) {
            transcript.appendSystem("error", (e as Error).message);
          }
        })();
        return;
      }
      if (prompt === "/tools") {
        void (async () => {
          try {
            const list = await client.toolsList();
            transcript.appendSystem("tools", list);
          } catch (e) {
            transcript.appendSystem("error", (e as Error).message);
          }
        })();
        return;
      }
      if (prompt.trim() === "") return;

      setHistory((h) => [...h, prompt]);
      transcript.appendUser(prompt);
      const assistantId = transcript.appendAssistant();
      activeAssistantIdRef.current = assistantId;
      setActiveBump((n) => n + 1);
      setWaitingForFirstToken(true);

      void (async () => {
        let handle: SendMessageHandle | null = null;
        try {
          let sid = sessionId;
          if (sid === null) {
            const summary = await client.sessionCreate();
            sid = summary.id;
            setSessionId(sid);
          }

          handle = client.sendMessage(sid, {
            role: "user",
            content: [{ type: "text", text: prompt }],
          });
          handleRef.current = handle;

          handle.onPermissionRequest(
            (req) =>
              new Promise((resolve) => {
                setPermission({
                  tool: req.tool,
                  args: req.tool_args,
                  resolve: (decision) => {
                    setPermission(null);
                    resolve({ decision });
                  },
                });
              }),
          );

          handle.onEvent((raw: unknown) => {
            if (raw === null || typeof raw !== "object") return;
            const ev = raw as StreamEventLike;
            const kind = ev.kind ?? "";

            if (kind === "text_delta") {
              const chunk = typeof ev.text === "string" ? ev.text : "";
              if (chunk.length === 0) return;
              setWaitingForFirstToken(false);
              transcript.appendToken(assistantId, chunk);
              return;
            }

            if (kind === "tool_call_started" || kind === "tool_use") {
              // First evidence of model output — drop the spinner.
              setWaitingForFirstToken(false);
              const invocationId =
                eventInvocationId(ev) ??
                `inv-${Math.random().toString(36).slice(2)}`;
              const call: ToolCallState = {
                invocationId,
                tool: eventToolName(ev),
                args: ev.args ?? null,
                status: "running",
              };
              transcript.appendToolCall(assistantId, call);
              return;
            }

            if (kind === "tool_call_completed" || kind === "tool_result") {
              const invocationId = eventInvocationId(ev);
              if (invocationId === undefined) return;
              const isErr = eventIsError(ev);
              const resultText = eventResultText(ev);
              const patch: Partial<ToolCallState> = {
                status: isErr ? "error" : "done",
              };
              if (resultText !== undefined) patch.result = resultText;
              transcript.updateToolCall(assistantId, invocationId, patch);
              return;
            }
            // Unknown kinds (thinking_delta, iteration_completed, ...) are
            // ignored at this layer.
          });

          await handle.done;
        } catch (e) {
          if (e instanceof BridgeCancelled) {
            // Partial response already accumulated; finally finalizes the turn.
          } else {
            transcript.appendSystem("error", (e as Error).message);
            // If session.create itself blew up, the REPL is unusable —
            // surface as a runtime error so we render the red banner.
            if (sessionId === null) setRuntimeError(e as Error);
          }
        } finally {
          if (handleRef.current === handle) handleRef.current = null;
          if (activeAssistantIdRef.current === assistantId) {
            activeAssistantIdRef.current = null;
            setActiveBump((n) => n + 1);
          }
          setWaitingForFirstToken(false);
          transcript.finishAssistant(assistantId);
        }
      })();
    },
    [client, sessionId, transcript, app],
  );

  if (error !== null) {
    return <Text color="red">error: {error.message}</Text>;
  }
  if (runtimeError !== null) {
    return <Text color="red">error: {runtimeError.message}</Text>;
  }
  if (!ready || client === null) {
    return <Text dimColor>connecting…</Text>;
  }

  // Split transcript into completed (Static) + active (dynamic). The active
  // item is the assistant turn currently streaming — anything else (older
  // turns, user prompts, system blocks) is "done" from Ink's perspective and
  // safe to memoize in <Static>.
  const activeId = activeAssistantIdRef.current;
  const completed: TranscriptItem[] = transcript.items.filter((it) => {
    if (activeId === null) return true;
    return !(it.kind === "assistant" && it.id === activeId);
  });
  const active: TranscriptItem | undefined =
    activeId !== null
      ? transcript.items.find(
          (it) => it.kind === "assistant" && it.id === activeId,
        )
      : undefined;

  const sessionShort = sessionId !== null ? `${sessionId.slice(0, 8)}…` : null;
  // Right side of StatusBar prioritizes the exit hint, then a cancel hint
  // when a turn is inflight, otherwise telemetry/idle.
  const cancelHint: string | null = exitHintVisible
    ? "press Ctrl+C again to exit"
    : handleRef.current !== null
      ? "Ctrl+C to cancel"
      : null;

  return (
    <Box flexDirection="column">
      <Static items={completed}>
        {(item) => <TranscriptItemView key={item.id} item={item} />}
      </Static>
      {active !== undefined && <TranscriptItemView item={active} />}
      <Spinner active={waitingForFirstToken} />
      {permission !== null && (
        <PermissionDialog
          tool={permission.tool}
          args={permission.args}
          onDecide={permission.resolve}
        />
      )}
      <PromptInput history={history} onSubmit={submit} />
      <StatusBar
        provider={args.provider}
        model={args.model}
        sessionIdShort={sessionShort}
        yolo={args.yolo}
        telemetry={telemetry}
        cancelHint={cancelHint}
      />
    </Box>
  );
}
