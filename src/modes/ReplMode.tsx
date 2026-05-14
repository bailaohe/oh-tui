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
import {
  SelectModal,
  type SelectOption,
} from "../components/SelectModal.js";
import { Spinner } from "../components/Spinner.js";
import { StatusBar } from "../components/StatusBar.js";
import { TranscriptItemView } from "../components/TranscriptItemView.js";
import { messagesToTranscript } from "../lib/replay.js";
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

/**
 * Catalog of provider choices for `/provider`. Hints reflect the meta-harney
 * ProviderSpec catalog's default model; pickers display them so users see what
 * they'll get if they don't subsequently `/model`-switch.
 */
const PROVIDER_OPTIONS: SelectOption[] = [
  { value: "anthropic", label: "anthropic", hint: "claude-sonnet-4-5" },
  { value: "openai", label: "openai", hint: "gpt-4o" },
  { value: "deepseek", label: "deepseek", hint: "deepseek-chat" },
  { value: "moonshot", label: "moonshot", hint: "kimi-k2-0905-preview" },
  { value: "gemini", label: "gemini", hint: "gemini-2.0-flash" },
  { value: "minimax", label: "minimax", hint: "MiniMax-M2" },
  { value: "nvidia", label: "nvidia", hint: "meta/llama-3.1-405b" },
  { value: "dashscope", label: "dashscope", hint: "qwen-max" },
  { value: "modelscope", label: "modelscope", hint: "Qwen2.5-72B" },
];

/**
 * Hardcoded per-provider model catalog mirroring meta-harney's ProviderSpec.
 * Kept in this file (not imported) so swapping the bridge binary doesn't break
 * the picker — the cost is occasional drift, which we accept for v1.
 */
const MODEL_OPTIONS: Record<string, string[]> = {
  anthropic: [
    "claude-sonnet-4-5",
    "claude-opus-4-5",
    "claude-haiku-4-5",
  ],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  moonshot: ["kimi-k2-0905-preview"],
  gemini: ["gemini-2.0-flash", "gemini-1.5-pro"],
  minimax: ["MiniMax-M2"],
  nvidia: ["meta/llama-3.1-405b-instruct"],
  dashscope: ["qwen-max", "qwen-plus", "qwen-turbo"],
  modelscope: ["Qwen2.5-72B-Instruct"],
};

/**
 * Profile choices for v1. The bridge expects profiles to already be configured
 * via `oh auth login --profile <name>`; we can't currently enumerate them
 * remotely, so we offer the two most common slots as a guided shortcut.
 */
const PROFILE_OPTIONS: SelectOption[] = [
  { value: "default", label: "default" },
  {
    value: "work",
    label: "work",
    hint: "requires `oh auth login --profile work`",
  },
];

export function ReplMode({ args }: ReplModeProps): React.JSX.Element {
  const { client, ready, error, restart } = useBridgeClient(args);
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
  // /sessions modal: when non-null, renders a SelectModal whose options are
  // built from the most recent `client.sessionList()` snapshot. `null` means
  // "no modal up". Setting back to null both on select and on cancel.
  const [sessionsModal, setSessionsModal] = useState<{
    options: SelectOption[];
  } | null>(null);
  // Live mirror of the CliArgs that were used to spawn the *current* bridge.
  // Mutated by `/provider`, `/model`, `/profile` flows so subsequent switches
  // compose on top of the most recent state rather than the original argv.
  const [activeArgs, setActiveArgs] = useState<CliArgs>(args);
  // Provider/model/profile pickers — at most one is non-null at a time. The
  // JSX renders the first one that's set; the others stay hidden. Combined
  // with the existing permission + sessions modals, this gives us a 5-way
  // mutex enforced declaratively in the render block.
  const [providerModal, setProviderModal] = useState<SelectOption[] | null>(
    null,
  );
  const [modelModal, setModelModal] = useState<SelectOption[] | null>(null);
  const [profileModal, setProfileModal] = useState<SelectOption[] | null>(
    null,
  );
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
      const resumeMatch = /^\/resume\s+(\S+)$/.exec(prompt);
      if (resumeMatch !== null) {
        const id = resumeMatch[1]!;
        void (async () => {
          try {
            const session = await client.sessionLoad(id);
            const items = messagesToTranscript(session.messages);
            transcript.replayMessages(items);
            setSessionId(session.id);
            transcript.appendSystem(
              "info",
              `resumed session ${session.id.slice(0, 8)}…`,
            );
          } catch (e) {
            transcript.appendSystem("error", (e as Error).message);
          }
        })();
        return;
      }
      if (prompt === "/sessions") {
        void (async () => {
          try {
            const list = await client.sessionList();
            if (list.length === 0) {
              transcript.appendSystem("info", "no sessions stored yet");
              return;
            }
            setSessionsModal({
              options: list.map((s) => ({
                value: s.id,
                label: `${s.id.slice(0, 12)}…`,
                hint: `${s.message_count} msgs · ${s.created_at.slice(0, 19)}`,
              })),
            });
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
      if (prompt === "/provider") {
        setProviderModal(PROVIDER_OPTIONS);
        return;
      }
      if (prompt === "/model") {
        // The picker keys off `activeArgs.provider` (not the original `args`)
        // so a sequence like `/provider deepseek` then `/model` shows the
        // right list. Fall back to "anthropic" when no provider was pinned —
        // matches the bridge's own default.
        const provider = activeArgs.provider ?? "anthropic";
        const models = MODEL_OPTIONS[provider] ?? [];
        if (models.length === 0) {
          transcript.appendSystem(
            "info",
            `no known models for ${provider}; use --model <name> at launch`,
          );
          return;
        }
        setModelModal(
          models.map((m) => ({ value: m, label: m })),
        );
        return;
      }
      if (prompt === "/profile") {
        setProfileModal(PROFILE_OPTIONS);
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
    [client, sessionId, transcript, app, activeArgs],
  );

  /**
   * Shared body for `/provider`, `/model`, `/profile` switches.
   *
   * The flow:
   *   1. Cancel any inflight send so the about-to-be-killed bridge doesn't
   *      leave a dangling permission/stream promise on our side. We swallow
   *      the cancel error: if the handle was never started or already done,
   *      `.cancel()` returns rejected and we don't care.
   *   2. Surface a "switching to X…" info line so the user sees something
   *      happen between the picker dismissing and `ready` flipping false.
   *   3. Build `next` by merging the partial patch over `activeArgs`. We store
   *      it on state so future switches compose, and pass it directly to
   *      `restart()` since the state setter is async.
   *   4. `restart()` returns the newly-initialized `BridgeClient` so we can
   *      issue the session-reload RPC without waiting for the React render
   *      that picks up the new client. This sidesteps the stale-closure
   *      problem entirely.
   *   5. Replay messages into the transcript so the conversation visibly
   *      continues. Any inflight assistant turn is gone by now (we cancelled
   *      it and the bridge that was streaming it is dead), so this is safe.
   */
  const performSwitch = useCallback(
    async (
      patch: Partial<CliArgs>,
      label: string,
    ): Promise<void> => {
      handleRef.current?.cancel().catch(() => {
        /* nothing to cancel, or already cancelled — both fine */
      });
      transcript.appendSystem("info", `switching to ${label}…`);
      const next: CliArgs = { ...activeArgs, ...patch };
      setActiveArgs(next);
      try {
        const newClient = await restart(next);
        if (sessionId !== null) {
          try {
            const session = await newClient.sessionLoad(sessionId);
            transcript.replayMessages(messagesToTranscript(session.messages));
            transcript.appendSystem(
              "info",
              `session ${session.id.slice(0, 8)}… reloaded`,
            );
          } catch (e) {
            // Session-load failure is non-fatal — the bridge is alive, the
            // user can still type. Surface the error so they know history
            // didn't carry over.
            transcript.appendSystem(
              "error",
              `session reload failed: ${(e as Error).message}`,
            );
          }
        }
      } catch (e) {
        transcript.appendSystem("error", (e as Error).message);
      }
    },
    [activeArgs, restart, sessionId, transcript],
  );

  const handleSwitchProvider = useCallback(
    (newProvider: string): void => {
      setProviderModal(null);
      // Clearing `model` on provider switch avoids passing a model name the
      // new provider doesn't recognize. The user can `/model` afterwards.
      void performSwitch(
        { provider: newProvider, model: null },
        `provider ${newProvider}`,
      );
    },
    [performSwitch],
  );

  const handleSwitchModel = useCallback(
    (newModel: string): void => {
      setModelModal(null);
      void performSwitch({ model: newModel }, `model ${newModel}`);
    },
    [performSwitch],
  );

  const handleSwitchProfile = useCallback(
    (newProfile: string): void => {
      setProfileModal(null);
      void performSwitch(
        { profile: newProfile },
        `profile ${newProfile}`,
      );
    },
    [performSwitch],
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
        {(item) => (
          <TranscriptItemView
            key={item.id}
            item={item}
            fullToolOutput={activeArgs.fullToolOutput}
          />
        )}
      </Static>
      {active !== undefined && (
        <TranscriptItemView
          item={active}
          fullToolOutput={activeArgs.fullToolOutput}
        />
      )}
      <Spinner active={waitingForFirstToken} />
      {permission !== null && (
        <PermissionDialog
          tool={permission.tool}
          args={permission.args}
          onDecide={permission.resolve}
        />
      )}
      {/* Modal mutex: at most one of permission / sessions / provider /
          model / profile is visible at a time. The order below is also the
          precedence — permission has the strongest claim because it blocks
          tool execution; the slash-command pickers are mutually exclusive
          via their state being driven only by `submit`, but we guard each
          branch defensively in case future code paths open two at once. */}
      {permission === null && sessionsModal !== null && (
        <SelectModal
          title="resume session"
          options={sessionsModal.options}
          onSelect={(id) => {
            setSessionsModal(null);
            // Reuse the /resume code path from Task 2 — submit() is wrapped
            // in useCallback so calling it here from a closure captures the
            // latest version.
            submit(`/resume ${id}`);
          }}
          onCancel={() => setSessionsModal(null)}
        />
      )}
      {permission === null &&
        sessionsModal === null &&
        providerModal !== null && (
          <SelectModal
            title="switch provider"
            options={providerModal}
            onSelect={handleSwitchProvider}
            onCancel={() => setProviderModal(null)}
          />
        )}
      {permission === null &&
        sessionsModal === null &&
        providerModal === null &&
        modelModal !== null && (
          <SelectModal
            title="switch model"
            options={modelModal}
            onSelect={handleSwitchModel}
            onCancel={() => setModelModal(null)}
          />
        )}
      {permission === null &&
        sessionsModal === null &&
        providerModal === null &&
        modelModal === null &&
        profileModal !== null && (
          <SelectModal
            title="switch profile"
            options={profileModal}
            onSelect={handleSwitchProfile}
            onCancel={() => setProfileModal(null)}
          />
        )}
      <PromptInput history={history} onSubmit={submit} />
      <StatusBar
        provider={activeArgs.provider}
        model={activeArgs.model}
        profile={activeArgs.profile}
        sessionIdShort={sessionShort}
        yolo={activeArgs.yolo}
        telemetry={telemetry}
        cancelHint={cancelHint}
      />
    </Box>
  );
}
