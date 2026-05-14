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
 *
 * StrictMode safety: React 18 fires effects twice in dev. We use a
 * `startedRef` latch so we only ever spawn one subprocess per mount.
 */

import { useEffect, useRef, useState } from "react";
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
}

export function useBridgeClient(args: CliArgs): UseBridgeClientResult {
  const [client, setClient] = useState<BridgeClient | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [ready, setReady] = useState(false);
  // Latch to defeat React StrictMode's intentional double-invoke of effects:
  // we must not spawn the bridge subprocess twice.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const framing: Framing =
      args.framing === "content-length"
        ? new ContentLengthFraming()
        : new NewlineFraming();

    // Translate CliArgs into the argv we pass to `oh bridge`. We always
    // lead with the `bridge` subcommand, then forward only the flags the
    // user explicitly set so the server applies its own defaults for the
    // rest.
    const bridgeArgs: string[] = ["bridge"];
    if (args.provider !== null) bridgeArgs.push("--provider", args.provider);
    if (args.profile !== null) bridgeArgs.push("--profile", args.profile);
    if (args.model !== null) bridgeArgs.push("--model", args.model);
    if (args.framing === "content-length") {
      bridgeArgs.push("--framing", "content-length");
    }
    if (args.yolo) bridgeArgs.push("--yolo");

    let transport: ChildProcessTransport;
    let c: BridgeClient;
    try {
      transport = new ChildProcessTransport({
        command: locateBridge(args.bridgeBin),
        args: bridgeArgs,
        framing,
      });
      c = new BridgeClient({ transport });
    } catch (e) {
      setError(e as Error);
      return;
    }

    let mounted = true;
    c.start()
      .then(() =>
        c.initialize({
          clientInfo: { name: "oh-tui", version: "0.1.0" },
        }),
      )
      .then(() => {
        if (!mounted) return;
        setClient(c);
        setReady(true);
      })
      .catch((e: Error) => {
        if (!mounted) return;
        setError(e);
      });

    return () => {
      mounted = false;
      // Best-effort teardown. The child may already be dead (crashed,
      // signaled, or never reached `initialize`), so we swallow errors
      // from both shutdown and exit. `exit()` is idempotent and also
      // stops the transport, so it's safe to call unconditionally.
      c.shutdown()
        .catch(() => {
          /* shutdown may fail if the bridge already closed */
        })
        .then(() => c.exit())
        .catch(() => {
          /* exit may fail if the transport is already dead */
        });
    };
    // We intentionally depend only on mount: re-spawning the bridge on
    // every prop change would orphan child processes. Consumers must
    // remount (e.g. via `key`) to pick up new CliArgs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { client, error, ready };
}
