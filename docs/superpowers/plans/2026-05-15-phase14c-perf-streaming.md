# Phase 14c Implementation Plan — 流式渲染性能优化

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Ship oh-tui v0.6.0 — assistant delta buffering（50ms / 384 chars）+ transcript ops 批量 flush + `useDeferredValue` 包裹高频更新；删 14a/b 剩余砍项（SidePanel、TodoPanel markdown 数据源）改为永久砍清单。

**Architecture:** 抽 `src/lib/deltaBuffer.ts` 通用 buffer 模块（可独立单元测试）。App.tsx 用 `createDeltaBuffer` 攒 `text_delta`、用 ref 队列 + 50ms timer 攒 `tool_call_*` ops，全部 flush 走 `startTransition` 标低优先级；`useDeferredValue` 包 ConversationView 输入。键盘相关 state 不 defer，保持紧急响应。

**Tech Stack:** TS 5 strict、Ink 5、React 18 + startTransition + useDeferredValue、vitest + ink-testing-library + jsdom、pnpm。

**Spec:** `docs/superpowers/specs/2026-05-15-phase14c-perf-streaming-design.md`

**Repo:** `/Users/baihe/Projects/study/oh-tui`（branch `master`，当前 v0.5.0）

---

## File map

| File | Action | Task |
|---|---|---|
| `src/lib/deltaBuffer.ts` | Create | T1 |
| `tests/lib/deltaBuffer.test.ts` | Create | T1 |
| `src/App.tsx` | Modify (buffer 集成 + useDeferredValue) | T2 |
| `package.json` | Modify (0.6.0) | T3 |
| `README.md` | Modify (v0.6.0 changelog + 砍清单更新) | T3 |

---

### Task 1: 抽 deltaBuffer 模块 + 测试

**Files:**
- Create: `src/lib/deltaBuffer.ts`
- Create: `tests/lib/deltaBuffer.test.ts`

- [ ] **Step 1: Create `src/lib/deltaBuffer.ts`**

```typescript
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
      // owner changed — flush previous owner first
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
```

- [ ] **Step 2: Create `tests/lib/deltaBuffer.test.ts`**

```typescript
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
    // Owner switch should have flushed "a"
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
```

- [ ] **Step 3: 测试 + typecheck**

```bash
cd /Users/baihe/Projects/study/oh-tui && pnpm test deltaBuffer && pnpm typecheck
```

预期：8/8 pass，typecheck 0 errors。

- [ ] **Step 4: Commit**

```bash
cd /Users/baihe/Projects/study/oh-tui && git add src/lib/deltaBuffer.ts tests/lib/deltaBuffer.test.ts
git commit -m "feat(lib): createDeltaBuffer — id-keyed text buffer with size + time flush

50ms / 384 chars 双阈值；切换 owner id 自动 flush 上一 owner，避免跨回合
泄漏；setTimer/clearTimer 可注入便于单元测试。8 个测试覆盖所有触发路径。

T2 在 App.tsx 集成。"
```

---

### Task 2: App.tsx 集成 buffer + useDeferredValue

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: imports 区**

打开 `src/App.tsx`。

**1a. react import 改造**：

当前可能是：
```typescript
import { useCallback, useEffect, useRef, useState } from "react";
```

改为：
```typescript
import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
```

如果 `useMemo` 已经在 imports 里就保留；若没有，加上（commandHints 派生未来想优化的可选位置）。

**1b. 添加 deltaBuffer import**：

```typescript
import { createDeltaBuffer, type DeltaBuffer } from "./lib/deltaBuffer.js";
```

- [ ] **Step 2: 在 AppInner 顶部加常量**

紧挨 `const VERSION = "0.6.0";` （T3 会把 VERSION 改 0.6.0；T2 这里如果当前是 0.4.0 / 0.5.0 / 其他，**不要改 VERSION**，保留现状由 T3 统一更新）—— 在 `const EXIT_HOLD_MS = 100;` 之后加：

```typescript
const ASSISTANT_DELTA_FLUSH_MS = 50;
const ASSISTANT_DELTA_FLUSH_CHARS = 384;
const TRANSCRIPT_OP_FLUSH_MS = 50;
```

- [ ] **Step 3: 在 AppInner 内加 refs**

在现有 `handleRef` / `activeAssistantIdRef` / `sentInitialRef` / `exitTimerRef` 附近加：

```typescript
const pendingTranscriptOpsRef = useRef<Array<() => void>>([]);
const transcriptFlushTimerRef = useRef<NodeJS.Timeout | null>(null);
```

deltaBuffer 用 useRef + useEffect 初始化（避免 useMemo 在 React 严格模式下重建）：

```typescript
const deltaBufferRef = useRef<DeltaBuffer | null>(null);
if (deltaBufferRef.current === null) {
  deltaBufferRef.current = createDeltaBuffer({
    flushMs: ASSISTANT_DELTA_FLUSH_MS,
    flushChars: ASSISTANT_DELTA_FLUSH_CHARS,
    onFlush: (id, text) => {
      startTransition(() => {
        transcript.appendToken(id, text);
      });
    },
  });
}
```

**关键**：`onFlush` 闭包捕获 `transcript`，但 transcript 在每次 render 都是新对象（`useTranscript` 返回新对象）。这样 deltaBufferRef 第一次创建后 `onFlush` 引用的 transcript 是过期的，appendToken 会用第一次的 closure —— **bug**。

修正方案：deltaBuffer 的 onFlush 通过中间 ref 拿最新 transcript：

```typescript
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
```

每次 render 更新 transcriptRef.current。这样 onFlush 永远拿当前 transcript。

- [ ] **Step 4: queueTranscriptOp + flushTranscriptOps**

紧接 deltaBufferRef 初始化之后加：

```typescript
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
```

- [ ] **Step 5: unmount cleanup**

在现有 useEffect 之后加：

```typescript
useEffect(() => {
  return () => {
    deltaBufferRef.current?.dispose();
    if (transcriptFlushTimerRef.current !== null) {
      clearTimeout(transcriptFlushTimerRef.current);
      transcriptFlushTimerRef.current = null;
    }
  };
}, []);
```

- [ ] **Step 6: 改造 handle.onEvent 路由（在 submit 内）**

找到 `handle.onEvent((raw: unknown) => { ... })` 内的三个 kind 分支，**替换**：

**6a. text_delta**

```diff
- if (kind === "text_delta") {
-   const chunk = typeof ev.text === "string" ? ev.text : "";
-   if (chunk.length === 0) return;
-   setWaitingForFirstToken(false);
-   transcript.appendToken(assistantId, chunk);
-   return;
- }
+ if (kind === "text_delta") {
+   const chunk = typeof ev.text === "string" ? ev.text : "";
+   if (chunk.length === 0) return;
+   setWaitingForFirstToken(false);
+   deltaBufferRef.current?.push(assistantId, chunk);
+   return;
+ }
```

**6b. tool_call_started / tool_use**

```diff
- if (kind === "tool_call_started" || kind === "tool_use") {
-   setWaitingForFirstToken(false);
-   const invocationId =
-     eventInvocationId(ev) ?? `inv-${Math.random().toString(36).slice(2)}`;
-   const toolName = eventToolName(ev);
-   transcript.appendTool(invocationId, toolName, ev.args ?? null);
-   if (toolName === "todo_write") {
-     const parsed = parseTodos(ev.args);
-     if (parsed !== null) setLatestTodos(parsed);
-   }
-   return;
- }
+ if (kind === "tool_call_started" || kind === "tool_use") {
+   setWaitingForFirstToken(false);
+   const invocationId =
+     eventInvocationId(ev) ?? `inv-${Math.random().toString(36).slice(2)}`;
+   const toolName = eventToolName(ev);
+   const args = ev.args ?? null;
+   queueTranscriptOp(() => transcript.appendTool(invocationId, toolName, args));
+   if (toolName === "todo_write") {
+     const parsed = parseTodos(ev.args);
+     if (parsed !== null) setLatestTodos(parsed);
+   }
+   return;
+ }
```

**6c. tool_call_completed / tool_result**

```diff
- if (kind === "tool_call_completed" || kind === "tool_result") {
-   const invocationId = eventInvocationId(ev);
-   if (invocationId === undefined) return;
-   transcript.appendToolResult(invocationId, eventResultText(ev), eventIsError(ev));
-   return;
- }
+ if (kind === "tool_call_completed" || kind === "tool_result") {
+   const invocationId = eventInvocationId(ev);
+   if (invocationId === undefined) return;
+   const text = eventResultText(ev);
+   const isErr = eventIsError(ev);
+   queueTranscriptOp(() => transcript.appendToolResult(invocationId, text, isErr));
+   return;
+ }
```

- [ ] **Step 7: finally 块 drain**

在 submit 内的 `} finally { ... }` 块开头（**在** `if (handleRef.current === handle) handleRef.current = null;` **之前**）加：

```typescript
deltaBufferRef.current?.flush();
flushTranscriptOps();
```

- [ ] **Step 8: useDeferredValue 派生**

紧挨 transcript 声明之后（在 `const transcript = useTranscript();` 后、history state 前）加：

```typescript
const deferredItems = useDeferredValue(transcript.items);
const deferredTodos = useDeferredValue(latestTodos);
const deferredTelemetry = useDeferredValue(telemetry);
```

注意：`latestTodos` 和 `telemetry` 在后面才声明 —— 这两行 useDeferredValue 要**移到那些 state 声明之后**。具体顺序：

1. `const transcript = useTranscript();`
2. 所有 useState 声明（包括 telemetry / latestTodos）
3. `const deferredItems = useDeferredValue(transcript.items);`
4. `const deferredTodos = useDeferredValue(latestTodos);`
5. `const deferredTelemetry = useDeferredValue(telemetry);`

- [ ] **Step 9: 渲染区使用 deferred 值**

```diff
- <ConversationView
-   items={transcript.items}
+ <ConversationView
+   items={deferredItems}
    activeAssistantId={activeAssistantIdRef.current}
    ...
  />

- {latestTodos !== null && <TodoPanel todos={latestTodos} />}
+ {deferredTodos !== null && <TodoPanel todos={deferredTodos} />}

  <StatusBar
    provider={...}
    model={...}
    profile={activeArgs.profile}
    sessionIdShort={sessionShort}
    yolo={activeArgs.yolo}
-   telemetry={telemetry}
+   telemetry={deferredTelemetry}
    cancelHint={cancelHint}
  />
```

`activeAssistantId` 仍用 `activeAssistantIdRef.current`（不 defer）。

`showWelcome` 计算用未 defer 的 `transcript.items.length`：

```typescript
const showWelcome = transcript.items.length === 0 && args.prompt === null;
```

保持原样 —— welcome 显示判断不需要 defer。

- [ ] **Step 10: typecheck + test**

```bash
cd /Users/baihe/Projects/study/oh-tui && pnpm typecheck
```
预期：0 errors。

```bash
cd /Users/baihe/Projects/study/oh-tui && pnpm test
```
预期：所有现有 + 新增 deltaBuffer 8 个测试全 pass（约 59/59）。

- [ ] **Step 11: Commit**

```bash
cd /Users/baihe/Projects/study/oh-tui && git add src/App.tsx
git commit -m "$(cat <<'EOF'
perf(tui): assistant delta buffering + useDeferredValue + startTransition

- text_delta 攒到 50ms 或 384 chars 才 flush 到 transcript
  （通过 src/lib/deltaBuffer.ts 的 createDeltaBuffer）
- tool_call_started / tool_call_completed 批量 flush（50ms timer + ref 队列）
- 所有 flush 通过 startTransition 标低优先级
- useDeferredValue 包裹 transcript.items / latestTodos / telemetry，
  让 React concurrent renderer 在键盘事件等紧急更新时优先响应
- finally 块 drain：finishAssistant 前先 flush，确保 cursor 隐藏
  在最后一行文本之后
- unmount cleanup：dispose deltaBuffer + clearTimeout transcript timer
- transcriptRef 闭包绕过：onFlush 通过 ref 拿最新 transcript

性能预期：高频流式输出从每事件 setState → 每 50ms / 每 384 字符 setState，
React re-render 频率 ~10x 降低，键盘事件响应优先级提升。
EOF
)"
```

---

### Task 3: v0.6.0 release

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `src/App.tsx`（VERSION 常量 0.5.0 → 0.6.0）

- [ ] **Step 1: Bump version**

`package.json`：`"version": "0.5.0"` → `"version": "0.6.0"`。

`src/App.tsx` 顶部 `const VERSION = "0.5.0";` → `const VERSION = "0.6.0";`。

如果当前 VERSION 不是 0.5.0（如还是 0.4.0），不要紧——直接改为 0.6.0。

- [ ] **Step 2: 更新 README.md**

读 README，找到 `## v0.5.0 — CommandPicker + 键位对齐 (Phase 14b)` 这行。

用 Edit 把 `## v0.5.0 — CommandPicker + 键位对齐 (Phase 14b)` **替换**为：

```
## v0.6.0 — 流式渲染性能优化 (Phase 14c)

- **delta buffering**：assistant 文本流 50ms / 384 字符触发一次 flush，高频流式输出 re-render 频率约 10x 降低
- **transcript ops 批量 flush**：tool_call_started / tool_call_completed 也走 50ms ref 队列
- **`startTransition`** 包裹所有非紧急 transcript 更新，键盘输入永远优先响应
- **`useDeferredValue`** 包裹 ConversationView items / TodoPanel todos / StatusBar telemetry，React concurrent 标记低优先级
- 新模块 `src/lib/deltaBuffer.ts`（含 8 个单元测试），timer 接口可注入便于测试
- **finally drain**：finishAssistant 前先 flush，确保 cursor 落在最后一行文本之后

### Phase 14 永久砍清单（14a/b/c 综合）

以下功能 OpenHarness 有但 oh-tui **不实现**（不会进入未来 phase）：

- **SwarmPanel** + swarm 协议 —— oh-mini 没 multi-agent 后端
- **permission_mode 系统**（/permissions /plan）—— oh-mini 没有 permission_mode 概念
- **/vim /voice** —— 无后端
- **/effort /passes /turns** —— oh-mini 不暴露 reasoning 配置
- **/output-style codex 模式** —— 无后端
- **Mcp / Bridge 状态计数** —— 无数据源
- **shift+enter 多行输入** —— ink-text-input 限制
- **SidePanel**（32% 宽侧栏 status/tasks/mcp/bridge/commands）—— 数据源缺失或与 StatusBar/Footer/TodoPanel/CommandPicker 冗余
- **TodoPanel markdown 数据源**（OpenHarness 风格 bridge 直发 `todo_markdown`）—— 跨仓库 oh-mini 协议改动，与"不改 protocol"决策矛盾；当前 `parseTodos` 方案等价

## v0.5.0 — CommandPicker + 键位对齐 (Phase 14b)
```

- [ ] **Step 3: 全量质量门**

```bash
cd /Users/baihe/Projects/study/oh-tui && pnpm typecheck && pnpm test && pnpm lint
```

- [ ] **Step 4: Commit + tag**

```bash
cd /Users/baihe/Projects/study/oh-tui && git add package.json README.md src/App.tsx
git commit -m "$(cat <<'EOF'
release: oh-tui v0.6.0 — 流式渲染性能优化 (Phase 14c)

- delta buffering (50ms / 384 chars) + startTransition
- transcript ops 批量 flush (50ms ref 队列)
- useDeferredValue 包裹 ConversationView items / TodoPanel todos / StatusBar telemetry
- src/lib/deltaBuffer.ts 通用模块 + 8 个测试

Phase 14 (a+b+c) 完成。永久砍清单已写入 README：
SwarmPanel / permission_mode / vim/voice / effort/passes/turns /
output-style / mcp/bridge / shift+enter / SidePanel / TodoPanel markdown
EOF
)"
git tag -a v0.6.0 -m "v0.6.0 — Phase 14c 流式渲染性能优化"
```

不要 push。

---

## Self-Review

**Spec coverage**：

| Spec 项 | Task |
|---|---|
| 节 1 buffer + flush 实现 | T2 |
| 节 1 finishAssistant 同步 (finally drain) | T2 |
| 节 1 unmount cleanup | T2 |
| 节 2 useDeferredValue 应用 | T2 |
| 节 3 deltaBuffer 单元测试 | T1 |
| 节 4 release v0.6.0 + 砍清单更新 | T3 |
| 节 4 永久砍 SidePanel + TodoPanel markdown | T3（README） |

全覆盖。

**Placeholder scan**：搜全文，无 TBD/TODO/"add appropriate"。每段代码完整给出。

**Type consistency**：
- `DeltaBuffer` interface T1 定义、T2 通过 `import { ... type DeltaBuffer }` 使用一致
- `createDeltaBuffer(opts)` 签名 `{ flushMs, flushChars, onFlush, setTimer?, clearTimer? }` T1 定义、T2 调用使用 3 必填参数一致
- `transcriptRef.current.appendToken(id, text)` 签名 `(string, string) => void` 与 T1 useTranscript 一致

## Execution

Subagent-Driven。T1 → T2 → T3 串行。T2 是 14c 大头（多处 App.tsx 改）。
