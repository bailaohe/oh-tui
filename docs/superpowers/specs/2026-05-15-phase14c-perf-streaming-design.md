# Phase 14c — 流式渲染性能优化

## Goal

把 oh-tui 的 `text_delta` 高频事件渲染从"每事件 setState"改成 OpenHarness 风格的"buffer + 节流 flush"，配合 React 18 `useDeferredValue` 把转录视图标记为低优先级，消除高频流式输入时的闪烁、抖动和不必要的 re-render。

发布版本：v0.5.0 → **v0.6.0**。

## Scope 收紧

### 砍：14a 原 14c 列表中的两项

14a spec 把 14c 列为四项：delta buffering、useDeferredValue、SidePanel、TodoPanel markdown 数据源。14b 实施后审视，砍后两项：

| 砍项 | 理由 |
|---|---|
| **SidePanel**（32% 宽侧栏 status/tasks/mcp/bridge/commands）| oh-mini 没 mcp/bridge 数据源；status 已在 StatusBar+Footer 双显；tasks 走 TodoPanel；commands 走 14b 的 CommandPicker。再加侧栏是第三重冗余，且会切走主对话视图宽度 |
| **TodoPanel markdown 数据源**（OpenHarness 风格：bridge 直接发 `todo_markdown` 字符串）| 需要改 oh-mini 后端协议字段（跨仓库），与"不改 protocol"的 14a scope 决策矛盾。当前 oh-tui 已用 `parseTodos(args)` 从 `todo_write` 工具调用解析 — 实质等价 |

这两项归入**永久砍**清单（与 SwarmPanel、permission_mode、vim/voice、effort/passes/turns、Mcp/Bridge 计数、shift+enter 并列）。

### 14c 做

1. **assistant delta buffering**（OpenHarness 完整复刻）：text_delta 攒到 50ms 或 384 chars 才 flush 一次到 transcript
2. **transcript items 批量 flush**：tool_call_started / tool_call_completed / appendUser 等事件也走 50ms buffer，集中 setState
3. **useDeferredValue**：包裹 transcript items / latestTodos 等高频更新 state，让 React concurrent renderer 把它们标记为低优先级，键盘输入永远优先响应
4. **StrictMode 双调用安全**：buffer 的 setTimeout / setInterval 用 ref 持有，cleanup 严格

## Architecture

### 当前数据流（v0.5.0）

```
bridge event → handle.onEvent(raw) → switch(kind):
  text_delta       → setWaitingForFirstToken(false) + transcript.appendToken(id, chunk)   ← 直接 setState
  tool_call_*      → transcript.appendTool/appendToolResult                                ← 直接 setState
  ...
```

每个 `text_delta` 事件（几十 token/秒）都触发一次 React setState，React 18 自动批处理只在同一 microtask 内合并，跨 microtask 还是会触发独立 re-render。

### 14c 数据流

```
bridge event → handle.onEvent(raw) → switch(kind):
  text_delta       → queueAssistantDelta(id, chunk)
  tool_call_*      → queueTranscriptOp(...)
  ...

queueAssistantDelta(id, chunk):
  pendingDeltaRef.current += chunk
  if (pendingDeltaRef.current.length >= 384) flushAssistantDelta()
  else if (assistantFlushTimerRef.current === null) schedule(50ms)

flushAssistantDelta():
  startTransition(() => transcript.appendToken(id, pending))
  pendingDeltaRef.current = ""
  assistantFlushTimerRef.current = null

queueTranscriptOp(op):
  pendingOpsRef.current.push(op)
  if (transcriptFlushTimerRef.current === null) schedule(50ms)

flushTranscriptOps():
  startTransition(() => pendingOps.forEach(op => op()))
  pendingOpsRef.current = []
  transcriptFlushTimerRef.current = null
```

`startTransition` 把这些更新标记为非紧急，React 优先处理键盘事件等紧急更新。

### useDeferredValue 应用点

```typescript
const deferredItems       = useDeferredValue(transcript.items);
const deferredTodos       = useDeferredValue(latestTodos);
const deferredTelemetry   = useDeferredValue(telemetry);
```

`ConversationView` / `TodoPanel` / `StatusBar` 用 deferredXxx 渲染，键盘输入触发的 state（input/historyIdx/pickerIndex）保持紧急。

## 节 1 — Buffer + flush 实现细节

### Refs 与 state

App.tsx 新增 refs（与现有 handleRef 等并列）：

```typescript
const pendingAssistantDeltaRef = useRef("");
const pendingAssistantIdRef    = useRef<string | null>(null);  // 当前 buffer 归属
const assistantFlushTimerRef   = useRef<NodeJS.Timeout | null>(null);

const pendingTranscriptOpsRef  = useRef<Array<() => void>>([]);
const transcriptFlushTimerRef  = useRef<NodeJS.Timeout | null>(null);
```

### 常量

```typescript
const ASSISTANT_DELTA_FLUSH_MS    = 50;
const ASSISTANT_DELTA_FLUSH_CHARS = 384;
const TRANSCRIPT_OP_FLUSH_MS      = 50;
```

### flushAssistantDelta

```typescript
const flushAssistantDelta = useCallback((): void => {
  const pending = pendingAssistantDeltaRef.current;
  const id = pendingAssistantIdRef.current;
  pendingAssistantDeltaRef.current = "";
  if (assistantFlushTimerRef.current !== null) {
    clearTimeout(assistantFlushTimerRef.current);
    assistantFlushTimerRef.current = null;
  }
  if (pending.length === 0 || id === null) return;
  startTransition(() => {
    transcript.appendToken(id, pending);
  });
}, [transcript]);
```

### queueAssistantDelta

```typescript
const queueAssistantDelta = useCallback(
  (id: string, chunk: string): void => {
    if (chunk.length === 0) return;
    if (pendingAssistantIdRef.current !== id) {
      // 切换到新 assistant 回合，先把上一个 buffer flush 掉
      flushAssistantDelta();
      pendingAssistantIdRef.current = id;
    }
    pendingAssistantDeltaRef.current += chunk;
    if (pendingAssistantDeltaRef.current.length >= ASSISTANT_DELTA_FLUSH_CHARS) {
      flushAssistantDelta();
      return;
    }
    if (assistantFlushTimerRef.current === null) {
      assistantFlushTimerRef.current = setTimeout(
        flushAssistantDelta,
        ASSISTANT_DELTA_FLUSH_MS,
      );
    }
  },
  [flushAssistantDelta],
);
```

### transcript ops 队列

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

### 事件路由改造（submit 内 handle.onEvent）

```diff
- if (kind === "text_delta") {
-   setWaitingForFirstToken(false);
-   transcript.appendToken(assistantId, chunk);
- }
+ if (kind === "text_delta") {
+   setWaitingForFirstToken(false);
+   queueAssistantDelta(assistantId, chunk);
+ }

- if (kind === "tool_call_started" ...) {
-   transcript.appendTool(invocationId, toolName, ev.args);
- }
+ if (kind === "tool_call_started" ...) {
+   queueTranscriptOp(() => transcript.appendTool(invocationId, toolName, ev.args ?? null));
+ }

- if (kind === "tool_call_completed" ...) {
-   transcript.appendToolResult(invocationId, ..., isError);
- }
+ if (kind === "tool_call_completed" ...) {
+   queueTranscriptOp(() => transcript.appendToolResult(invocationId, resultText, isErr));
+ }
```

### finishAssistant 的同步性

`handle.done` 后调用 `finishAssistant(assistantId)` —— **先 flush** assistant delta + transcript ops，确保 finishAssistant 标记的 item 已经合并完所有 token：

```typescript
} finally {
  // Drain buffers before marking done so the cursor disappears on the
  // final text rather than after the next flush tick.
  flushAssistantDelta();
  flushTranscriptOps();
  if (handleRef.current === handle) handleRef.current = null;
  if (activeAssistantIdRef.current === assistantId) {
    activeAssistantIdRef.current = null;
    setActiveBump((n) => n + 1);
  }
  setWaitingForFirstToken(false);
  transcript.finishAssistant(assistantId);
  ...
}
```

### Unmount cleanup

App unmount 时如果还有 pending buffer，清理 timer 避免泄漏：

```typescript
useEffect(() => {
  return () => {
    if (assistantFlushTimerRef.current !== null) {
      clearTimeout(assistantFlushTimerRef.current);
    }
    if (transcriptFlushTimerRef.current !== null) {
      clearTimeout(transcriptFlushTimerRef.current);
    }
  };
}, []);
```

## 节 2 — useDeferredValue 应用

### App.tsx 内派生

紧挨 transcript 之后：

```typescript
const deferredItems     = useDeferredValue(transcript.items);
const deferredTodos     = useDeferredValue(latestTodos);
const deferredTelemetry = useDeferredValue(telemetry);
```

### 渲染区使用

```diff
- <ConversationView items={transcript.items} ... />
+ <ConversationView items={deferredItems} ... />

- {latestTodos !== null && <TodoPanel todos={latestTodos} />}
+ {deferredTodos !== null && <TodoPanel todos={deferredTodos} />}

- <StatusBar ... telemetry={telemetry} ... />
+ <StatusBar ... telemetry={deferredTelemetry} ... />
```

**注意**：`activeAssistantId` 不要 defer —— 它由 ref 派生，且对 `<Static>` 切分正确性很关键。

### 不 defer 的 state

- `input` / `pickerIndex` / `historyIdx` / `draft` / `lastEscapeAt` —— 键盘输入紧急路径
- `permission` / `*Modal` —— 模态对话框出现要立即
- `sessionId` / `ready` / `error` / `runtimeError` —— 控制流，立即
- `activeAssistantId`（在 ref 里）—— 见上

## 节 3 — 测试

### 单元测试

无法直接对 50ms timer 做断言（vitest fake timers 可行但脆）。**改为对 flush 函数行为做单元测试**：

`tests/lib/deltaBuffer.test.ts`（**新建**）

为了可测，把 buffer 逻辑抽到独立 module `src/lib/deltaBuffer.ts`：

```typescript
export interface DeltaBuffer {
  push: (id: string, chunk: string) => void;
  flush: () => void;
  dispose: () => void;
}

export interface DeltaBufferOptions {
  flushMs: number;
  flushChars: number;
  onFlush: (id: string, text: string) => void;
}

export function createDeltaBuffer(opts: DeltaBufferOptions): DeltaBuffer { ... }
```

测试覆盖：
1. push 短文本不立即 flush（小于 flushChars）
2. push 累计到 flushChars 立即 flush
3. push 后等 flushMs 自动 flush
4. flush 后 buffer 清空
5. 切换 id 触发上一 id 的 flush
6. dispose 清 timer

App.tsx 用这个 `createDeltaBuffer({ flushMs: 50, flushChars: 384, onFlush: (id, text) => transcript.appendToken(id, text) })`。

transcript ops 队列同理，但**不抽 module**（更简单，App.tsx 内联，因为 ops 都是 closure，独立 module 反而复杂）。

### 集成测试

不做 — Ink + fake timers + concurrent React 三层异步组合脆，价值低。手工 smoke 覆盖。

### 手工 smoke

`pnpm start`，让 LLM 输出一段长文本（如让它写 50 行代码）：

1. 流式文本平滑出现，无闪烁（v0.5 偶有"字符跳动"）
2. 流式期间打字（输入命令准备插队），键盘响应不卡
3. 流式期间按 ↑↓ 滚 history，输入框响应不卡
4. 流完触发 spinner 消失 + cursor 消失，最后一行文本完整
5. 工具调用（让 LLM 用 Bash）流式 + tool call 混合事件，顺序正确

## 节 4 — Release

- `package.json`: `0.5.0` → **`0.6.0`**
- `README.md`：在 v0.5.0 块之上插入 v0.6.0 changelog
- `git tag v0.6.0`

Changelog 要点：
- delta buffering（50ms / 384 chars）
- transcript ops 批量 flush
- `useDeferredValue` 包裹高频更新
- `createDeltaBuffer` 抽到 `src/lib/deltaBuffer.ts` 便于测试
- 永久砍：SidePanel + TodoPanel markdown 数据源（移入 14c README 砍清单）

## 风险

| 风险 | 缓解 |
|---|---|
| flush 时序与 finishAssistant 竞争（done 后还有 pending token）| finally 块先调 flushAssistantDelta + flushTranscriptOps |
| useDeferredValue 滞后导致用户看到的状态不一致 | deferred 只用于 visual layer（ConversationView/TodoPanel/StatusBar telemetry）；逻辑判断（cancelHint、activeAssistantId）用未 defer 原值 |
| StrictMode 双 useEffect 双注册 timer | 所有 timer 走 ref，cleanup 严格 clearTimeout + null 化 |
| 测试用 fake timer 不稳 | 抽 deltaBuffer module，注入 setTimeout/clearTimeout 替换为同步执行的桩；测试用桩验证逻辑 |
| `startTransition` 在 Ink 18 下未生效 | Ink 5 跟 React 18 concurrent 兼容；若发现无效，降级为直接调用（性能上仍有 buffer 节流收益） |

## 范围外（明确）

- SidePanel → **永久砍**
- TodoPanel markdown 数据源 → **永久砍**
- shift+enter 多行 → 14d 评估
- 自动滚动到最底部 → 14d 评估（如有需要）
- 性能基准测试套件 → 14d 评估
