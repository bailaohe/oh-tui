/**
 * OneShotMode — fire-and-exit flow for `oh-tui "<prompt>"` (Phase 12 rewrite).
 *
 * Mirrors the ReplMode rewrite but with a single turn:
 *   - One user item, one assistant item; no PromptInput, no history.
 *   - Uses `useCancelBinding` (NOT `useCancelOrExit`) — there's no exit dance
 *     because the mode auto-exits after `handle.done` settles. A single
 *     Ctrl+C cancels the inflight send; if pressed after completion it's a
 *     no-op (the ref is null).
 *   - Uses the transcript model + <TranscriptItemView> so MarkdownText,
 *     <ToolCallView>, and system-block rendering stay consistent between modes.
 *   - <Spinner> shows between submit and the first `text_delta`.
 *   - <StatusBar> at the bottom mirrors the REPL footer (provider/model/
 *     session/yolo + telemetry).
 *   - `app.exit()` fires in `finally` after a short hold so the user can see
 *     the final frame (cursor gone, last badge flipped to ✓/✗).
 *
 * StrictMode: an outer ref-latch guards the send pipeline so the effect
 * doesn't fire twice in dev.
 */

import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Box, Text, useApp } from "ink";
import {
  BridgeCancelled,
  type PermissionDecision,
  type SendMessageHandle,
} from "@meta-harney/bridge-client";
import { useBridgeClient } from "../hooks/useBridgeClient.js";
import { useCancelBinding } from "../hooks/useKeybinds.js";
import { useTranscript } from "../hooks/useTranscript.js";
import { PermissionDialog } from "../components/PermissionDialog.js";
import { Spinner } from "../components/Spinner.js";
import { StatusBar } from "../components/StatusBar.js";
import { TranscriptItemView } from "../components/TranscriptItemView.js";
import type { CliArgs, ToolCallState } from "../types.js";

export interface OneShotModeProps {
  args: CliArgs;
}

interface PendingPermission {
  tool: string;
  args: unknown;
  resolve: (decision: PermissionDecision) => void;
}

/** Duck-typed StreamEvent — mirrors ReplMode. */
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

/** Visual hold so the final frame is observable before Ink unmounts. */
const EXIT_HOLD_MS = 100;

export function OneShotMode({ args }: OneShotModeProps): React.JSX.Element {
  const { client, error, ready } = useBridgeClient(args);
  const transcript = useTranscript();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [permission, setPermission] = useState<PendingPermission | null>(null);
  const [runtimeError, setRuntimeError] = useState<Error | null>(null);
  const [telemetry, setTelemetry] = useState<{
    event_type: string;
    elapsed_ms: number;
  } | null>(null);
  const [waitingForFirstToken, setWaitingForFirstToken] = useState(false);

  // Guard against StrictMode's double-invoke spawning two send_message flows.
  const startedRef = useRef(false);
  // Live send handle for Ctrl+C cancellation. Null before send and after
  // `done` settles (or cancels).
  const handleRef = useRef<SendMessageHandle | null>(null);
  const app = useApp();

  useCancelBinding(() => {
    const h = handleRef.current;
    if (h === null) return;
    h.cancel().catch(() => {
      /* cancel may race with normal completion — ignore */
    });
  });

  // Subscribe to bridge telemetry — same shape as ReplMode.
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
      /* non-fatal */
    });
  }, [client]);

  useEffect(() => {
    if (!ready || client === null) return;
    if (args.prompt === null || args.prompt === undefined) return;
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    let handle: SendMessageHandle | null = null;

    // Seed the transcript with the user prompt + an empty assistant turn.
    const prompt = args.prompt;
    transcript.appendUser(prompt);
    const assistantId = transcript.appendAssistant();
    setWaitingForFirstToken(true);

    void (async () => {
      try {
        const summary = await client.sessionCreate();
        if (cancelled) return;
        setSessionId(summary.id);

        handle = client.sendMessage(summary.id, {
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
        });

        await handle.done;
      } catch (e) {
        if (cancelled) return;
        // BridgeCancelled is a clean exit path — keep whatever streamed, drop
        // the spinner, fall through to the finally so we still app.exit().
        if (!(e instanceof BridgeCancelled)) {
          setRuntimeError(e as Error);
        }
      } finally {
        if (handleRef.current === handle) handleRef.current = null;
        setWaitingForFirstToken(false);
        transcript.finishAssistant(assistantId);
        if (!cancelled) {
          setTimeout(() => {
            if (!cancelled) app.exit();
          }, EXIT_HOLD_MS);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Effect intentionally fires once after the bridge is ready. Re-running
    // would re-send the prompt; downstream consumers should remount via `key`
    // if they need to retry.
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

  const sessionShort = sessionId !== null ? `${sessionId.slice(0, 8)}…` : null;
  // OneShot doesn't have an exit dance — the only volatile hint is whether
  // a cancel is currently possible.
  const cancelHint: string | null =
    handleRef.current !== null ? "Ctrl+C to cancel" : null;

  return (
    <Box flexDirection="column">
      {transcript.items.map((item) => (
        <TranscriptItemView
          key={item.id}
          item={item}
          fullToolOutput={args.fullToolOutput}
        />
      ))}
      <Spinner active={waitingForFirstToken} />
      {permission !== null && (
        <PermissionDialog
          tool={permission.tool}
          args={permission.args}
          onDecide={permission.resolve}
        />
      )}
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
