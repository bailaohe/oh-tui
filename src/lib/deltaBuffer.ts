/**
 * deltaBuffer — accumulate streamed text chunks and flush them on a
 * size or time threshold.
 *
 * Phase 14c uses this to throttle ConversationView re-renders during
 * fast `text_delta` streams. The buffer is keyed by an "owner id" (the
 * assistant transcript item id); switching owners flushes the previous
 * owner first so chunks never leak across turns.
 *
 * Timer + clearTimeout injection (`setTimer` / `clearTimer`) lets tests
 * drive the buffer deterministically without fake timers.
 */

export interface DeltaBufferOptions {
  flushMs: number;
  flushChars: number;
  onFlush: (id: string, text: string) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface DeltaBuffer {
  push: (id: string, chunk: string) => void;
  flush: () => void;
  dispose: () => void;
}

export function createDeltaBuffer(opts: DeltaBufferOptions): DeltaBuffer {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let pendingId: string | null = null;
  let pendingText = "";
  let timer: unknown = null;

  const clearTimerIfAny = (): void => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const flush = (): void => {
    clearTimerIfAny();
    if (pendingText.length === 0 || pendingId === null) return;
    const id = pendingId;
    const text = pendingText;
    pendingText = "";
    opts.onFlush(id, text);
  };

  const push = (id: string, chunk: string): void => {
    if (chunk.length === 0) return;
    if (pendingId !== null && pendingId !== id) {
      flush();
    }
    pendingId = id;
    pendingText += chunk;
    if (pendingText.length >= opts.flushChars) {
      flush();
      return;
    }
    if (timer === null) {
      timer = setTimer(() => {
        timer = null;
        flush();
      }, opts.flushMs);
    }
  };

  const dispose = (): void => {
    clearTimerIfAny();
    pendingText = "";
    pendingId = null;
  };

  return { push, flush, dispose };
}
