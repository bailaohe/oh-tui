/**
 * ReplMode — interactive multi-turn chat.
 *
 * Lifecycle:
 *   1. `useBridgeClient` spawns the bridge and we wait for `ready`.
 *   2. The first non-empty user prompt lazily calls `session.create` and we
 *      reuse the returned id for every subsequent turn (one session per
 *      REPL invocation).
 *   3. Each Enter from <PromptInput> either:
 *        - `/exit` or `/quit`  → app.exit() (no message sent)
 *        - empty / whitespace  → ignored (input is just cleared)
 *        - anything else       → appended to `history`, pushed as a new turn
 *          in scrollback, and forwarded to the bridge via `sendMessage`.
 *   4. Each turn's `SendMessageHandle` is wired to:
 *        - `onEvent` → accumulate `text_delta` chunks into the turn's
 *          response field (other event kinds are ignored at this layer).
 *        - `onPermissionRequest` → surface a <PermissionDialog> so tool
 *          approval works inside the REPL too (mirrors OneShotMode T14).
 *      When `handle.done` settles we flip the turn's `done` flag so
 *      <StreamingMessage> drops the trailing cursor.
 *
 * Notes:
 *   - We don't keep `SendMessageHandle` references around past `done` —
 *     cancellation is T16's responsibility.
 *   - All state mutations from async callbacks use functional setState so
 *     we don't capture stale `turns` between Enter presses.
 *   - Permission requests are serialized by the bridge per outstanding
 *     `send_message`, but if two turns ever overlap (e.g. cancel-then-retry
 *     in a later task) the dialog still only ever shows the most recent
 *     pending request — both promises share the same modal slot.
 */

import type React from "react";
import { useRef, useState } from "react";
import { Box, Text, useApp } from "ink";
import {
  BridgeCancelled,
  type PermissionDecision,
  type SendMessageHandle,
  type SessionListEntry,
  type ToolSpec,
} from "@meta-harney/bridge-client";
import { useBridgeClient } from "../hooks/useBridgeClient.js";
import { useCancelBinding } from "../hooks/useKeybinds.js";
import { PromptInput } from "../components/PromptInput.js";
import { PermissionDialog } from "../components/PermissionDialog.js";
import { SessionListPanel } from "../components/SessionListPanel.js";
import { StreamingMessage } from "../components/StreamingMessage.js";
import { ToolsListPanel } from "../components/ToolsListPanel.js";
import type { CliArgs } from "../types.js";

export interface ReplModeProps {
  args: CliArgs;
}

interface Turn {
  prompt: string;
  response: string;
  done: boolean;
}

interface PendingPermission {
  tool: string;
  args: unknown;
  resolve: (decision: PermissionDecision) => void;
}

/** Loosely typed StreamEvent — duck-typed because the bridge serializes
 *  pydantic events verbatim and we only consume `text_delta`'s `text`. */
interface StreamEventLike {
  kind?: string;
  text?: string;
}

export function ReplMode({ args }: ReplModeProps): React.JSX.Element {
  const { client, ready, error } = useBridgeClient(args);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [permission, setPermission] = useState<PendingPermission | null>(null);
  const [runtimeError, setRuntimeError] = useState<Error | null>(null);
  // Side-panel state. Each panel toggles via its slash-command: first
  // invocation fetches data + makes the panel visible, second invocation
  // hides it (we keep the cached data on the first toggle-off so re-opening
  // is instant; a third toggle refreshes). Mutual exclusivity isn't enforced
  // — both panels can be visible simultaneously, which keeps the UX
  // predictable (each command only touches its own state).
  const [sessions, setSessions] = useState<SessionListEntry[]>([]);
  const [sessionsVisible, setSessionsVisible] = useState(false);
  const [tools, setTools] = useState<ToolSpec[]>([]);
  const [toolsVisible, setToolsVisible] = useState(false);
  // Latest in-flight send handle, or null when no turn is streaming. We use
  // a ref (not state) because Ctrl+C should fire against the freshest
  // handle without forcing a re-render on every send/finish.
  const handleRef = useRef<SendMessageHandle | null>(null);
  const app = useApp();

  // Ctrl+C cancels the current turn via `$/cancelRequest`. When no turn is
  // in flight, the keypress is a no-op (we deliberately don't exit the REPL
  // — users have `/exit` for that). Cancellation rejects `handle.done` with
  // BridgeCancelled, which the try/finally below already treats as a
  // normal completion path.
  useCancelBinding(() => {
    const h = handleRef.current;
    if (h === null) return;
    h.cancel().catch(() => {
      /* cancel may race with normal completion — ignore */
    });
  });

  if (error !== null) {
    return <Text color="red">error: {error.message}</Text>;
  }
  if (runtimeError !== null) {
    return <Text color="red">error: {runtimeError.message}</Text>;
  }
  if (!ready || client === null) {
    return <Text dimColor>connecting…</Text>;
  }

  const onSubmit = (prompt: string): void => {
    // Slash-commands handled before any session work so we can /exit even
    // before the first message creates a session.
    if (prompt === "/exit" || prompt === "/quit") {
      app.exit();
      return;
    }
    // Side-panel toggles. Each command is its own toggle:
    //   - visible → hide (cheap, no RPC)
    //   - hidden  → fetch fresh data then show
    // Errors are surfaced via runtimeError so a transient RPC failure
    // doesn't silently swallow the user's command.
    if (prompt === "/sessions") {
      if (sessionsVisible) {
        setSessionsVisible(false);
      } else {
        void (async () => {
          try {
            const list = await client.sessionList();
            setSessions(list);
            setSessionsVisible(true);
          } catch (e) {
            setRuntimeError(e as Error);
          }
        })();
      }
      return;
    }
    if (prompt === "/tools") {
      if (toolsVisible) {
        setToolsVisible(false);
      } else {
        void (async () => {
          try {
            const list = await client.toolsList();
            setTools(list);
            setToolsVisible(true);
          } catch (e) {
            setRuntimeError(e as Error);
          }
        })();
      }
      return;
    }
    if (prompt.trim() === "") {
      // Empty submit (just hitting Enter) — drop silently. PromptInput has
      // already cleared its buffer.
      return;
    }

    // Append to history immediately so the user sees their input even if
    // session.create hasn't resolved yet.
    setHistory((h) => [...h, prompt]);

    // Snapshot the turn index so async callbacks update the right slot
    // even after later turns are appended.
    const turnIdx = turns.length;
    setTurns((prev) => [...prev, { prompt, response: "", done: false }]);

    void (async () => {
      // Declared outside the try so the finally block can compare against
      // the handle we published into `handleRef`.
      let handle: SendMessageHandle | null = null;
      try {
        // Lazily create the session on the first real prompt. Subsequent
        // turns reuse the cached id.
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
        // Publish the live handle so `useCancelBinding` can target it. We
        // overwrite unconditionally — only one turn is in flight at a time
        // because PromptInput won't surface another submit until this
        // closure's finally runs.
        handleRef.current = handle;

        // Route permission/request RPCs to the modal. The resolver wrapper
        // clears the dialog atomically with the decision so a fast second
        // request can't race the unmount of the previous one.
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
          if (ev.kind !== "text_delta") return;
          const chunk = typeof ev.text === "string" ? ev.text : "";
          if (chunk.length === 0) return;
          setTurns((prev) =>
            prev.map((t, i) =>
              i === turnIdx ? { ...t, response: t.response + chunk } : t,
            ),
          );
        });

        await handle.done;
      } catch (e) {
        // Ctrl+C cancellation is a normal completion path — keep whatever
        // text streamed so far and let the finally block mark the turn
        // done. We deliberately don't append an `[error]` line for these.
        if (e instanceof BridgeCancelled) {
          // no-op — turn already shows partial response; cursor will drop
          // when `done` flips below.
        } else {
          // Surface the error inline on the turn rather than nuking the
          // REPL — a single failed send shouldn't kill the session.
          setTurns((prev) =>
            prev.map((t, i) =>
              i === turnIdx
                ? {
                    ...t,
                    response:
                      t.response.length > 0
                        ? `${t.response}\n[error] ${(e as Error).message}`
                        : `[error] ${(e as Error).message}`,
                  }
                : t,
            ),
          );
          // Stash on the runtimeError state only if there's no session yet
          // — that means session.create itself blew up and the REPL is
          // unusable.
          if (sessionId === null) setRuntimeError(e as Error);
        }
      } finally {
        // Clear the cancel target so a stray Ctrl+C after completion
        // doesn't try to cancel a finished handle.
        if (handleRef.current === handle) handleRef.current = null;
        setTurns((prev) =>
          prev.map((t, i) => (i === turnIdx ? { ...t, done: true } : t)),
        );
      }
    })();
  };

  const sessionDisplay =
    sessionId !== null ? `${sessionId.slice(0, 8)}…` : "no session";

  return (
    <Box flexDirection="column">
      <Text dimColor>oh-tui · {sessionDisplay}</Text>
      {turns.map((t, i) => (
        <Box key={i} flexDirection="column" marginTop={1}>
          <Text dimColor>&gt; {t.prompt}</Text>
          <StreamingMessage text={t.response} finished={t.done} />
        </Box>
      ))}
      {permission !== null && (
        <PermissionDialog
          tool={permission.tool}
          args={permission.args}
          onDecide={permission.resolve}
        />
      )}
      {/* Side panels are informational, not modal — they sit above the
          prompt so the user can keep typing without losing focus, and a
          repeat of the same slash-command toggles them away. */}
      {sessionsVisible && <SessionListPanel sessions={sessions} />}
      {toolsVisible && <ToolsListPanel tools={tools} />}
      <PromptInput history={history} onSubmit={onSubmit} />
    </Box>
  );
}
