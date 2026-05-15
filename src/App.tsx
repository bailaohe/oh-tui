/**
 * App — single Ink component that drives oh-tui.
 *
 * Replaces the modes/ReplMode + modes/OneShotMode split. The `--prompt` flag
 * (or a single positional argument) seeds the first user turn; `--exit-on-done`
 * exits Ink after that first turn finishes (== the old OneShotMode behavior).
 * Without `--exit-on-done`, App stays in REPL mode and accepts more input.
 *
 * State + events follow the Phase 12 ReplMode shape, adapted to the flat
 * TranscriptItem model from T1: text_delta still appends to the active
 * assistant turn; tool_call_started pushes a top-level "tool" row;
 * tool_call_completed pushes a top-level "tool_result" row.
 */

import type React from "react";
import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import { Box, Text, useApp, useInput } from "ink";
import {
  BridgeCancelled,
  type PermissionDecision,
  type SendMessageHandle,
} from "@meta-harney/bridge-client";
import { useBridgeClient } from "./hooks/useBridgeClient.js";
import { useTranscript } from "./hooks/useTranscript.js";
import { CommandPicker } from "./components/CommandPicker.js";
import { ConversationView } from "./components/ConversationView.js";
import { Footer } from "./components/Footer.js";
import { PermissionDialog } from "./components/PermissionDialog.js";
import { PromptInput } from "./components/PromptInput.js";
import {
  SelectModal,
  type SelectOption,
} from "./components/SelectModal.js";
import { Spinner } from "./components/Spinner.js";
import { StatusBar } from "./components/StatusBar.js";
import { TodoPanel, parseTodos, type TodoItem } from "./components/TodoPanel.js";
import { createDeltaBuffer, type DeltaBuffer } from "./lib/deltaBuffer.js";
import { messagesToTranscript } from "./lib/replay.js";
import { ThemeProvider, useTheme } from "./theme/ThemeContext.js";
import type { CliArgs } from "./types.js";

const VERSION = "0.4.0";
const EXIT_HOLD_MS = 100;
const ASSISTANT_DELTA_FLUSH_MS = 50;
const ASSISTANT_DELTA_FLUSH_CHARS = 384;
const TRANSCRIPT_OP_FLUSH_MS = 50;

export interface AppProps {
  args: CliArgs;
}

export function App({ args }: AppProps): React.JSX.Element {
  return (
    <ThemeProvider initialTheme={args.theme}>
      <AppInner args={args} />
    </ThemeProvider>
  );
}

interface PendingPermission {
  tool: string;
  args: unknown;
  resolve: (decision: PermissionDecision) => void;
}

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
function eventResultText(e: StreamEventLike): string {
  const r = e.result;
  if (typeof r === "string") return r;
  if (r !== undefined && r !== null && typeof r === "object") {
    try {
      return JSON.stringify(r);
    } catch {
      return "";
    }
  }
  if (typeof e.error === "string") return e.error;
  return "";
}

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

const MODEL_OPTIONS: Record<string, string[]> = {
  anthropic: ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  moonshot: ["kimi-k2-0905-preview"],
  gemini: ["gemini-2.0-flash", "gemini-1.5-pro"],
  minimax: ["MiniMax-M2"],
  nvidia: ["meta/llama-3.1-405b-instruct"],
  dashscope: ["qwen-max", "qwen-plus", "qwen-turbo"],
  modelscope: ["Qwen2.5-72B-Instruct"],
};

const PROFILE_OPTIONS: SelectOption[] = [
  { value: "default", label: "default" },
  {
    value: "work",
    label: "work",
    hint: "requires `oh auth login --profile work`",
  },
];

function AppInner({ args }: AppProps): React.JSX.Element {
  const { client, ready, error, effective, restart } = useBridgeClient(args);
  const transcript = useTranscript();
  const [history, setHistory] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [permission, setPermission] = useState<PendingPermission | null>(null);
  const [runtimeError, setRuntimeError] = useState<Error | null>(null);
  const [telemetry, setTelemetry] = useState<{ event_type: string; elapsed_ms: number } | null>(null);
  const [waitingForFirstToken, setWaitingForFirstToken] = useState(false);
  const [sessionsModal, setSessionsModal] = useState<{ options: SelectOption[] } | null>(null);
  const [activeArgs, setActiveArgs] = useState<CliArgs>(args);
  const [providerModal, setProviderModal] = useState<SelectOption[] | null>(null);
  const [modelModal, setModelModal] = useState<SelectOption[] | null>(null);
  const [profileModal, setProfileModal] = useState<SelectOption[] | null>(null);
  const [, setActiveBump] = useState(0);
  const [latestTodos, setLatestTodos] = useState<TodoItem[] | null>(null);
  const [input, setInput] = useState("");
  const [pickerIndex, setPickerIndex] = useState(0);
  const [historyIdx, setHistoryIdx] = useState<number>(0);
  const [draft, setDraft] = useState("");
  const [lastEscapeAt, setLastEscapeAt] = useState(0);
  const [themeModal, setThemeModal] = useState<SelectOption[] | null>(null);
  const { setThemeName } = useTheme();

  const handleRef = useRef<SendMessageHandle | null>(null);
  const activeAssistantIdRef = useRef<string | null>(null);
  const sentInitialRef = useRef(false);
  const exitTimerRef = useRef<NodeJS.Timeout | null>(null);
  const app = useApp();

  const pendingTranscriptOpsRef = useRef<Array<() => void>>([]);
  const transcriptFlushTimerRef = useRef<NodeJS.Timeout | null>(null);

  // transcriptRef 让 deltaBuffer.onFlush 拿最新 transcript（useTranscript 每次 render 返回新对象，
  // 直接闭包会过期）
  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;

  const deltaBufferRef = useRef<DeltaBuffer | null>(null);
  if (deltaBufferRef.current === null) {
    deltaBufferRef.current = createDeltaBuffer({
      flushMs: ASSISTANT_DELTA_FLUSH_MS,
      flushChars: ASSISTANT_DELTA_FLUSH_CHARS,
      onFlush: (id, text) => {
        startTransition(() => {
          transcriptRef.current.appendToken(id, text);
        });
      },
    });
  }

  const flushTranscriptOps = useCallback((): void => {
    const ops = pendingTranscriptOpsRef.current;
    pendingTranscriptOpsRef.current = [];
    if (transcriptFlushTimerRef.current !== null) {
      clearTimeout(transcriptFlushTimerRef.current);
      transcriptFlushTimerRef.current = null;
    }
    if (ops.length === 0) return;
    startTransition(() => {
      for (const op of ops) op();
    });
  }, []);

  const queueTranscriptOp = useCallback(
    (op: () => void): void => {
      pendingTranscriptOpsRef.current.push(op);
      if (transcriptFlushTimerRef.current === null) {
        transcriptFlushTimerRef.current = setTimeout(
          flushTranscriptOps,
          TRANSCRIPT_OP_FLUSH_MS,
        );
      }
    },
    [flushTranscriptOps],
  );

  const deferredItems = useDeferredValue(transcript.items);
  const deferredTodos = useDeferredValue(latestTodos);
  const deferredTelemetry = useDeferredValue(telemetry);

  // telemetry subscription
  useEffect(() => {
    if (client === null) return;
    client.onTelemetry((ev) => {
      const payload = ev.payload as { duration_ms?: number } | null;
      const elapsed =
        payload !== null && typeof payload.duration_ms === "number"
          ? payload.duration_ms
          : 0;
      setTelemetry({ event_type: ev.event_type, elapsed_ms: Math.round(elapsed) });
    });
    void client.telemetrySubscribe(true).catch(() => {});
  }, [client]);

  useEffect(() => {
    return () => {
      deltaBufferRef.current?.dispose();
      if (transcriptFlushTimerRef.current !== null) {
        clearTimeout(transcriptFlushTimerRef.current);
        transcriptFlushTimerRef.current = null;
      }
    };
  }, []);

  const COMMANDS: string[] = [
    "/help",
    "/exit",
    "/quit",
    "/sessions",
    "/tools",
    "/provider",
    "/model",
    "/profile",
    "/theme",
    "/resume",
  ];

  const commandHints = (() => {
    const v = input.trim();
    if (!v.startsWith("/")) return [] as string[];
    return COMMANDS.filter((c) => c.startsWith(v)).slice(0, 10);
  })();

  const showPicker =
    commandHints.length > 0 &&
    !waitingForFirstToken &&
    permission === null &&
    sessionsModal === null &&
    providerModal === null &&
    modelModal === null &&
    profileModal === null &&
    themeModal === null;

  // reset picker index when hints change
  useEffect(() => {
    setPickerIndex(0);
  }, [commandHints.length, input]);

  const submit = useCallback(
    (prompt: string): void => {
      if (client === null) return;
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
            transcript.replayMessages(messagesToTranscript(session.messages));
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
        const provider = activeArgs.provider ?? "anthropic";
        const models = MODEL_OPTIONS[provider] ?? [];
        if (models.length === 0) {
          transcript.appendSystem(
            "info",
            `no known models for ${provider}; use --model <name> at launch`,
          );
          return;
        }
        setModelModal(models.map((m) => ({ value: m, label: m })));
        return;
      }
      if (prompt === "/profile") {
        setProfileModal(PROFILE_OPTIONS);
        return;
      }
      if (prompt === "/theme") {
        setThemeModal([
          { value: "default", label: "default" },
          { value: "dark", label: "dark" },
          { value: "minimal", label: "minimal" },
        ]);
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
              deltaBufferRef.current?.push(assistantId, chunk);
              return;
            }

            if (kind === "tool_call_started" || kind === "tool_use") {
              setWaitingForFirstToken(false);
              const invocationId =
                eventInvocationId(ev) ?? `inv-${Math.random().toString(36).slice(2)}`;
              const toolName = eventToolName(ev);
              const args = ev.args ?? null;
              queueTranscriptOp(() => transcript.appendTool(invocationId, toolName, args));
              if (toolName === "todo_write") {
                const parsed = parseTodos(ev.args);
                if (parsed !== null) setLatestTodos(parsed);
              }
              return;
            }

            if (kind === "tool_call_completed" || kind === "tool_result") {
              const invocationId = eventInvocationId(ev);
              if (invocationId === undefined) return;
              const text = eventResultText(ev);
              const isErr = eventIsError(ev);
              queueTranscriptOp(() => transcript.appendToolResult(invocationId, text, isErr));
              return;
            }
          });

          await handle.done;
        } catch (e) {
          if (!(e instanceof BridgeCancelled)) {
            transcript.appendSystem("error", (e as Error).message);
            if (sessionId === null) setRuntimeError(e as Error);
          }
        } finally {
          deltaBufferRef.current?.flush();
          flushTranscriptOps();
          if (handleRef.current === handle) handleRef.current = null;
          if (activeAssistantIdRef.current === assistantId) {
            activeAssistantIdRef.current = null;
            setActiveBump((n) => n + 1);
          }
          setWaitingForFirstToken(false);
          transcript.finishAssistant(assistantId);
          if (activeArgs.exitOnDone && sentInitialRef.current) {
            if (exitTimerRef.current !== null) clearTimeout(exitTimerRef.current);
            exitTimerRef.current = setTimeout(() => app.exit(), EXIT_HOLD_MS);
          }
        }
      })();
    },
    [client, sessionId, transcript, app, activeArgs],
  );

  // initial_prompt: fire once when bridge is ready.
  useEffect(() => {
    if (!ready || client === null) return;
    if (args.prompt === null) return;
    if (sentInitialRef.current) return;
    sentInitialRef.current = true;
    submit(args.prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, client]);

  useInput((inputStr, key) => {
    // 优先级 1：Ctrl+C
    if (key.ctrl && inputStr === "c") {
      if (handleRef.current !== null) {
        handleRef.current.cancel().catch(() => {});
        return;
      }
      app.exit();
      return;
    }

    // 优先级 2：数字键快选
    const activeModalOptions: SelectOption[] | null =
      sessionsModal !== null
        ? sessionsModal.options
        : providerModal !== null
          ? providerModal
          : modelModal !== null
            ? modelModal
            : profileModal !== null
              ? profileModal
              : themeModal;

    if (activeModalOptions !== null && /^[1-9]$/.test(inputStr)) {
      const idx = parseInt(inputStr, 10) - 1;
      const target = activeModalOptions[idx];
      if (target !== undefined) {
        if (sessionsModal !== null) {
          setSessionsModal(null);
          submit(`/resume ${target.value}`);
        } else if (providerModal !== null) {
          handleSwitchProvider(target.value);
        } else if (modelModal !== null) {
          handleSwitchModel(target.value);
        } else if (profileModal !== null) {
          handleSwitchProfile(target.value);
        } else if (themeModal !== null) {
          setThemeName(target.value);
          setThemeModal(null);
          transcript.appendSystem("info", `theme → ${target.value}`);
        }
      }
      return;
    }

    // 优先级 3：CommandPicker active
    if (showPicker) {
      if (key.upArrow) {
        setPickerIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setPickerIndex((i) => Math.min(commandHints.length - 1, i + 1));
        return;
      }
      if (key.return) {
        const selected = commandHints[pickerIndex];
        if (selected !== undefined) {
          setInput("");
          submit(selected);
        }
        return;
      }
      if (key.tab) {
        const selected = commandHints[pickerIndex];
        if (selected !== undefined) {
          setInput(selected);
        }
        return;
      }
      if (key.escape) {
        setInput("");
        return;
      }
      return;
    }

    // 优先级 4：双击 Esc 清空（非 picker）
    if (key.escape) {
      const now = Date.now();
      if (input.length > 0 && now - lastEscapeAt < 500) {
        setInput("");
        setLastEscapeAt(0);
        return;
      }
      setLastEscapeAt(now);
      return;
    }

    // 优先级 5：↑↓ history（非 picker，非 busy）
    if (handleRef.current === null) {
      if (key.upArrow) {
        if (history.length === 0) return;
        if (historyIdx === history.length) {
          setDraft(input);
          setHistoryIdx(history.length - 1);
          setInput(history[history.length - 1] ?? "");
          return;
        }
        const newIdx = Math.max(0, historyIdx - 1);
        if (newIdx === historyIdx) return;
        setHistoryIdx(newIdx);
        setInput(history[newIdx] ?? "");
        return;
      }
      if (key.downArrow) {
        if (historyIdx >= history.length) return;
        const newIdx = historyIdx + 1;
        setHistoryIdx(newIdx);
        setInput(newIdx === history.length ? draft : (history[newIdx] ?? ""));
        return;
      }
    }
  });

  // /provider /model /profile shared switch flow
  const performSwitch = useCallback(
    async (patch: Partial<CliArgs>, label: string): Promise<void> => {
      handleRef.current?.cancel().catch(() => {});
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
      void performSwitch({ provider: newProvider, model: null }, `provider ${newProvider}`);
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
      void performSwitch({ profile: newProfile }, `profile ${newProfile}`);
    },
    [performSwitch],
  );

  if (error !== null) return <Text color="red">error: {error.message}</Text>;
  if (runtimeError !== null) return <Text color="red">error: {runtimeError.message}</Text>;
  if (!ready || client === null) return <Text dimColor>connecting…</Text>;

  const sessionShort = sessionId !== null ? `${sessionId.slice(0, 8)}…` : null;
  const cancelHint: string | null =
    handleRef.current !== null ? "Ctrl+C to cancel" : null;

  const showWelcome = transcript.items.length === 0 && args.prompt === null;

  return (
    <Box flexDirection="column">
      <ConversationView
        items={deferredItems}
        activeAssistantId={activeAssistantIdRef.current}
        showWelcome={showWelcome}
        version={VERSION}
        fullToolOutput={activeArgs.fullToolOutput}
      />
      {deferredTodos !== null && <TodoPanel todos={deferredTodos} />}
      {showPicker && <CommandPicker hints={commandHints} selectedIndex={pickerIndex} />}
      <Spinner active={waitingForFirstToken} />
      {permission !== null && (
        <PermissionDialog
          tool={permission.tool}
          args={permission.args}
          onDecide={permission.resolve}
        />
      )}
      {permission === null && sessionsModal !== null && (
        <SelectModal
          title="resume session"
          options={sessionsModal.options}
          onSelect={(id) => {
            setSessionsModal(null);
            submit(`/resume ${id}`);
          }}
          onCancel={() => setSessionsModal(null)}
        />
      )}
      {permission === null && sessionsModal === null && providerModal !== null && (
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
      {permission === null &&
        sessionsModal === null &&
        providerModal === null &&
        modelModal === null &&
        profileModal === null &&
        themeModal !== null && (
          <SelectModal
            title="switch theme"
            options={themeModal}
            onSelect={(name) => {
              setThemeName(name);
              setThemeModal(null);
              transcript.appendSystem("info", `theme → ${name}`);
            }}
            onCancel={() => setThemeModal(null)}
          />
        )}
      <PromptInput
        value={input}
        onChange={(v) => {
          setInput(v);
          if (historyIdx !== history.length) setHistoryIdx(history.length);
        }}
        onSubmit={(v) => {
          setHistory((h) => [...h, v]);
          setHistoryIdx(history.length + 1);
          setDraft("");
          setInput("");
          submit(v);
        }}
        suppressSubmit={showPicker}
      />
      <StatusBar
        provider={activeArgs.provider ?? effective.provider}
        model={activeArgs.model ?? effective.model}
        profile={activeArgs.profile}
        sessionIdShort={sessionShort}
        yolo={activeArgs.yolo}
        telemetry={deferredTelemetry}
        cancelHint={cancelHint}
      />
      <Footer
        provider={activeArgs.provider ?? effective.provider}
        model={activeArgs.model ?? effective.model}
        sessionIdShort={sessionShort}
        yolo={activeArgs.yolo}
      />
    </Box>
  );
}
