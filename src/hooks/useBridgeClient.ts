/**
 * useBridgeClient — React hook that spawns an `oh bridge` subprocess,
 * wraps it in a `BridgeClient`, and exposes the client + readiness/error
 * state to consumers.
 *
 * Lifecycle:
 *   1. On mount, build a `ChildProcessTransport` over the located bridge
 *      executable with framing & CLI args derived from `CliArgs`.
 *   2. Call `client.start()` then `client.initialize(...)`. When that
 *      resolves, flip `ready` to true and publish the `client`.
 *   3. On unmount, shutdown + exit the client. Errors during teardown are
 *      swallowed because the child may already be dead (e.g. crashed,
 *      SIGTERM'd, or exited cleanly).
 *   4. `restart(newArgs)` tears down the current client and spawns a new
 *      one mid-REPL. Callers must `await` one restart before triggering
 *      another; concurrent restart calls are not handled gracefully in v1.
 *      Any in-flight permission/request from the old client will reject
 *      when the old transport is stopped — caller code should handle that.
 *
 * StrictMode safety: React 18 fires effects twice in dev. We use a
 * `startedRef` latch so we only ever spawn one subprocess per mount.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BridgeClient,
  ChildProcessTransport,
  NewlineFraming,
  ContentLengthFraming,
  type Framing,
} from "@meta-harney/bridge-client";
import type { CliArgs } from "../types.js";
import { locateBridge } from "../lib/locate-bridge.js";

export interface UseBridgeClientResult {
  client: BridgeClient | null;
  error: Error | null;
  ready: boolean;
  /**
   * Swap the running bridge for a fresh one with `newArgs`. Returns the
   * newly-initialized `BridgeClient` on success so callers can immediately
   * issue RPCs (e.g. `sessionLoad`) without waiting for the next render to
   * pick up the updated `client` state. Rejects if the new bridge fails to
   * start; in that case the hook's `error` is also set.
   */
  restart: (newArgs: CliArgs) => Promise<BridgeClient>;
}

// Translate CliArgs into the argv we pass to `oh bridge`. We always
// lead with the `bridge` subcommand, then forward only the flags the
// user explicitly set so the server applies its own defaults for the
// rest.
function buildBridgeArgs(args: CliArgs): string[] {
  const a: string[] = ["bridge"];
  if (args.provider !== null) a.push("--provider", args.provider);
  if (args.profile !== null) a.push("--profile", args.profile);
  if (args.model !== null) a.push("--model", args.model);
  if (args.framing === "content-length") {
    a.push("--framing", "content-length");
  }
  if (args.yolo) a.push("--yolo");
  return a;
}

async function startClient(args: CliArgs): Promise<BridgeClient> {
  const framing: Framing =
    args.framing === "content-length"
      ? new ContentLengthFraming()
      : new NewlineFraming();
  const transport = new ChildProcessTransport({
    command: locateBridge(args.bridgeBin),
    args: buildBridgeArgs(args),
    framing,
  });
  const client = new BridgeClient({ transport });
  await client.start();
  await client.initialize({
    clientInfo: { name: "oh-tui", version: "0.3.0" },
  });
  return client;
}

// Module-level singleton so cli.tsx can await teardown after Ink exits.
// useEffect cleanup is sync and can't await Promises, so we publish the
// live client here and let main() drain it on shutdown.
let _activeClient: BridgeClient | null = null;

export async function teardownActiveBridge(): Promise<void> {
  const c = _activeClient;
  if (c === null) return;
  _activeClient = null;
  await stopClient(c);
}

async function stopClient(client: BridgeClient): Promise<void> {
  // Best-effort teardown. The child may already be dead (crashed,
  // signaled, or never reached `initialize`), so we swallow errors
  // from both shutdown and exit. `exit()` is idempotent and also
  // stops the transport, so it's safe to call unconditionally.
  try {
    await client.shutdown();
  } catch {
    /* shutdown may fail if the bridge already closed */
  }
  try {
    await client.exit();
  } catch {
    /* exit may fail if the transport is already dead */
  }
}

export function useBridgeClient(args: CliArgs): UseBridgeClientResult {
  const [client, setClient] = useState<BridgeClient | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [ready, setReady] = useState(false);
  // Latch to defeat React StrictMode's intentional double-invoke of effects:
  // we must not spawn the bridge subprocess twice.
  const startedRef = useRef(false);
  // Tracks the live client across renders so `restart()` and the unmount
  // cleanup can tear down whatever is currently running.
  const clientRef = useRef<BridgeClient | null>(null);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let mounted = true;
    startClient(args)
      .then((c) => {
        if (!mounted) {
          // Component unmounted before initialize resolved — drop the
          // freshly-started client on the floor.
          void stopClient(c);
          return;
        }
        clientRef.current = c;
        _activeClient = c;
        setClient(c);
        setReady(true);
      })
      .catch((e: Error) => {
        if (mounted) setError(e);
      });

    return () => {
      mounted = false;
      // We don't await here (cleanup is sync) — main() awaits
      // `teardownActiveBridge()` after Ink finishes unmounting.
    };
    // We intentionally depend only on mount: re-spawning the bridge on
    // every prop change would orphan child processes. Use `restart()` to
    // explicitly swap the bridge with new args.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const restart = useCallback(
    async (newArgs: CliArgs): Promise<BridgeClient> => {
      setReady(false);
      const oldClient = clientRef.current;
      clientRef.current = null;
      setClient(null);
      if (oldClient !== null) {
        if (_activeClient === oldClient) _activeClient = null;
        await stopClient(oldClient);
      }
      try {
        const newClient = await startClient(newArgs);
        clientRef.current = newClient;
        _activeClient = newClient;
        setClient(newClient);
        setError(null);
        setReady(true);
        return newClient;
      } catch (e) {
        setError(e as Error);
        throw e as Error;
      }
    },
    [],
  );

  return { client, error, ready, restart };
}
