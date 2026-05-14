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
import { useState } from "react";
import { Box, Text, useApp } from "ink";
import type { PermissionDecision } from "@meta-harney/bridge-client";
import { useBridgeClient } from "../hooks/useBridgeClient.js";
import { PromptInput } from "../components/PromptInput.js";
import { PermissionDialog } from "../components/PermissionDialog.js";
import { StreamingMessage } from "../components/StreamingMessage.js";
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
  const app = useApp();

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
      try {
        // Lazily create the session on the first real prompt. Subsequent
        // turns reuse the cached id.
        let sid = sessionId;
        if (sid === null) {
          const summary = await client.sessionCreate();
          sid = summary.id;
          setSessionId(sid);
        }

        const handle = client.sendMessage(sid, {
          role: "user",
          content: [{ type: "text", text: prompt }],
        });

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
        // Surface the error inline on the turn rather than nuking the REPL
        // — a single failed send shouldn't kill the session.
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
        // Stash on the runtimeError state only if there's no session yet —
        // that means session.create itself blew up and the REPL is unusable.
        if (sessionId === null) setRuntimeError(e as Error);
      } finally {
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
      <PromptInput history={history} onSubmit={onSubmit} />
    </Box>
  );
}
