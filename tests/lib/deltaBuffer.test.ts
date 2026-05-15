import { describe, it, expect } from "vitest";
import { createDeltaBuffer } from "../../src/lib/deltaBuffer.js";

interface Pending {
  fn: () => void;
  ms: number;
}

function makeStub() {
  const flushed: Array<{ id: string; text: string }> = [];
  let nextHandle = 1;
  const timers = new Map<number, Pending>();

  const buf = createDeltaBuffer({
    flushMs: 50,
    flushChars: 384,
    onFlush: (id, text) => flushed.push({ id, text }),
    setTimer: (fn, ms) => {
      const h = nextHandle++;
      timers.set(h, { fn, ms });
      return h;
    },
    clearTimer: (h) => {
      timers.delete(h as number);
    },
  });

  return {
    buf,
    flushed,
    fireAllTimers: () => {
      const snapshot = [...timers.values()];
      timers.clear();
      for (const t of snapshot) t.fn();
    },
    pendingTimerCount: () => timers.size,
  };
}

describe("createDeltaBuffer", () => {
  it("does not flush a short chunk immediately", () => {
    const { buf, flushed } = makeStub();
    buf.push("a", "hi");
    expect(flushed).toEqual([]);
  });

  it("schedules a timer on the first short chunk", () => {
    const { buf, pendingTimerCount } = makeStub();
    buf.push("a", "hi");
    expect(pendingTimerCount()).toBe(1);
  });

  it("flushes when the buffer reaches flushChars", () => {
    const { buf, flushed } = makeStub();
    const big = "x".repeat(400);
    buf.push("a", big);
    expect(flushed).toEqual([{ id: "a", text: big }]);
  });

  it("flushes when the scheduled timer fires", () => {
    const { buf, flushed, fireAllTimers } = makeStub();
    buf.push("a", "hello");
    buf.push("a", " world");
    fireAllTimers();
    expect(flushed).toEqual([{ id: "a", text: "hello world" }]);
  });

  it("clears the buffer after a flush", () => {
    const { buf, flushed, fireAllTimers } = makeStub();
    buf.push("a", "one");
    fireAllTimers();
    buf.push("a", "two");
    fireAllTimers();
    expect(flushed).toEqual([
      { id: "a", text: "one" },
      { id: "a", text: "two" },
    ]);
  });

  it("flushes the previous owner when id changes", () => {
    const { buf, flushed } = makeStub();
    buf.push("a", "hello");
    buf.push("b", "world");
    expect(flushed).toEqual([{ id: "a", text: "hello" }]);
  });

  it("manual flush emits whatever is pending", () => {
    const { buf, flushed } = makeStub();
    buf.push("a", "abc");
    buf.flush();
    expect(flushed).toEqual([{ id: "a", text: "abc" }]);
  });

  it("dispose cancels pending timers without flushing", () => {
    const { buf, flushed, pendingTimerCount } = makeStub();
    buf.push("a", "abc");
    buf.dispose();
    expect(pendingTimerCount()).toBe(0);
    expect(flushed).toEqual([]);
  });
});
