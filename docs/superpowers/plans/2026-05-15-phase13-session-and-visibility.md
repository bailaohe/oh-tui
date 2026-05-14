# Phase 13 Plan — Session management + Agent visibility

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** oh-tui v0.3.0 ships:
- A side: `/resume <id>`, selectable `/sessions`, `/provider /model /profile` (bridge restart)
- B side: TodoPanel for `todo_write`, 5-line tool result truncation, Markdown blockquote

**Spec:** `docs/superpowers/specs/2026-05-15-phase13-session-and-visibility-design.md`

**Repo:** `/Users/baihe/Projects/study/oh-tui` (branch `master`)

**Tech stack:** Same as Phase 12 — TS 5 strict, Ink 5, React 18, vitest + ink-testing-library.

---

## File map

| File | Action | Task |
|---|---|---|
| `src/components/SelectModal.tsx` | Create | T1 |
| `src/lib/replay.ts` | Create | T2 |
| `src/hooks/useTranscript.ts` | Modify (+replayMessages) | T2 |
| `src/modes/ReplMode.tsx` | Modify (/resume command) | T2 |
| `src/modes/ReplMode.tsx` | Modify (/sessions opens modal) | T3 |
| `src/hooks/useBridgeClient.ts` | Modify (+restart(newArgs)) | T4 |
| `src/modes/ReplMode.tsx` | Modify (/provider /model /profile flows) | T5 |
| `src/components/TodoPanel.tsx` | Create | T6 |
| `src/components/TranscriptItemView.tsx` | Modify (detect todo_write) | T6 |
| `src/components/ToolCallView.tsx` | Modify (5-line truncation) | T7 |
| `src/types.ts` | Modify (`fullToolOutput` arg) | T7 |
| `src/cli.tsx` | Modify (parse --full-tool-output) | T7 |
| `src/lib/markdown.ts` | Modify (blockquote) | T8 |
| `tests/components/*.test.tsx` + `tests/lib/*.test.ts` | Create/extend | T1, T6, T8 |
| `package.json` + README + tag | Modify | T10 |

---

### Task 1: SelectModal component

**Files:**
- Create: `src/components/SelectModal.tsx`
- Create: `tests/components/SelectModal.test.tsx`

- [ ] **Step 1: Tests**

```typescript
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { SelectModal } from "../../src/components/SelectModal.js";

async function flush(): Promise<void> {
  await new Promise((r) => setImmediate(r));
}

describe("SelectModal", () => {
  it("renders title + options", () => {
    const { lastFrame } = render(
      <SelectModal
        title="pick"
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ]}
        onSelect={() => {}}
        onCancel={() => {}}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("pick");
    expect(out).toContain("Alpha");
    expect(out).toContain("Beta");
  });

  it("arrow down moves selection then enter calls onSelect", async () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <SelectModal
        title="x"
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
        onSelect={onSelect}
        onCancel={() => {}}
      />,
    );
    await flush();
    stdin.write("\x1B[B"); // down
    stdin.write("\r"); // enter
    await flush();
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("esc triggers onCancel", async () => {
    const onCancel = vi.fn();
    const { stdin } = render(
      <SelectModal
        title="x"
        options={[{ value: "a", label: "A" }]}
        onSelect={() => {}}
        onCancel={onCancel}
      />,
    );
    await flush();
    stdin.write("\x1B"); // ESC
    await flush();
    expect(onCancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implementation**

```typescript
import type React from "react";
import { useState } from "react";
import { Box, Text, useInput } from "ink";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

export interface SelectModalProps {
  title: string;
  options: SelectOption[];
  initialIndex?: number;
  onSelect: (value: string) => void;
  onCancel: () => void;
}

export function SelectModal({
  title,
  options,
  initialIndex = 0,
  onSelect,
  onCancel,
}: SelectModalProps): React.JSX.Element {
  const [idx, setIdx] = useState(initialIndex);

  useInput((_input, key) => {
    if (key.upArrow) {
      setIdx((i) => (i > 0 ? i - 1 : options.length - 1));
    } else if (key.downArrow) {
      setIdx((i) => (i < options.length - 1 ? i + 1 : 0));
    } else if (key.return) {
      const choice = options[idx];
      if (choice !== undefined) onSelect(choice.value);
    } else if (key.escape) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginY={1}>
      <Text bold>{title}</Text>
      <Box flexDirection="column" marginTop={1}>
        {options.map((opt, i) => {
          const active = i === idx;
          return (
            <Box key={opt.value}>
              <Text color={active ? "cyan" : undefined}>{active ? "▸ " : "  "}</Text>
              <Text bold={active}>{opt.label}</Text>
              {opt.hint !== undefined && <Text dimColor>  {opt.hint}</Text>}
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate · enter select · esc cancel</Text>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 3: Verify + commit**

```bash
pnpm test SelectModal
pnpm typecheck
git add src/components/SelectModal.tsx tests/components/SelectModal.test.tsx
git commit -m "feat(tui): SelectModal — arrow-key picker with esc cancel"
```

---

### Task 2: /resume <id> command + message replay

**Files:**
- Create: `src/lib/replay.ts`
- Modify: `src/hooks/useTranscript.ts` (+`replayMessages`)
- Modify: `src/modes/ReplMode.tsx`
- Create: `tests/lib/replay.test.ts`

- [ ] **Step 1: Investigate Message shape**

```bash
grep -rn "class Message\|^class Message\|Message:" /Users/baihe/Projects/study/meta-harney/src/meta_harney/abstractions/_types.py | head
```

The shape (from meta-harney):
```python
class Message(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: list[ContentBlock]  # TextBlock | ToolUseBlock | ToolResultBlock | ...
    timestamp: datetime | None = None
```

ContentBlock is a discriminated union. For replay v1, we only render TextBlock.

- [ ] **Step 2: Create `src/lib/replay.ts`**

```typescript
/**
 * Convert a Message[] (from session.load) into TranscriptItem[] for display.
 *
 * v1 limitations:
 * - Only text blocks are rendered with full fidelity.
 * - Tool calls / results are summarized as a single `[tool: name]` line per
 *   block to preserve causality without re-running tools.
 * - Replayed assistant items are marked `done: true` so the cursor doesn't
 *   blink on past responses.
 */

import type { TranscriptItem } from "../types.js";

interface RawMessage {
  role: "user" | "assistant" | "system";
  content: RawContentBlock[];
}

interface RawContentBlock {
  type: string;
  text?: string;
  name?: string; // tool_use
  tool_name?: string; // tool_result
}

let _replayCounter = 0;
function replayId(): string {
  _replayCounter += 1;
  return `replay-${_replayCounter}`;
}

export function messagesToTranscript(messages: unknown[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  for (const m of messages) {
    if (typeof m !== "object" || m === null) continue;
    const msg = m as RawMessage;
    if (!Array.isArray(msg.content)) continue;
    const text = extractText(msg.content);
    if (msg.role === "user") {
      items.push({ kind: "user", id: replayId(), text });
    } else if (msg.role === "assistant") {
      const toolSummaries = summarizeTools(msg.content);
      items.push({
        kind: "assistant",
        id: replayId(),
        text,
        done: true,
        toolCalls: toolSummaries,
      });
    } else if (msg.role === "system") {
      items.push({
        kind: "system",
        id: replayId(),
        subkind: "info",
        payload: text,
      });
    }
  }
  return items;
}

function extractText(content: RawContentBlock[]): string {
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

function summarizeTools(content: RawContentBlock[]): TranscriptItem extends infer T
  ? T extends { kind: "assistant"; toolCalls: infer X }
    ? X
    : never
  : never {
  // Note: we don't have the runtime tool result here, so synthesize stubs
  // with status "done" so the UI doesn't show running/error states for
  // historical tools.
  const calls: { invocationId: string; tool: string; args: unknown; status: "done" }[] = [];
  let i = 0;
  for (const b of content) {
    if (b.type === "tool_use" && typeof b.name === "string") {
      calls.push({
        invocationId: `replay-tool-${i}`,
        tool: b.name,
        args: null,
        status: "done",
      });
      i += 1;
    }
  }
  return calls as any;
}
```

(The `summarizeTools` return type is ugly — feel free to simplify to `Array<{...}>` matching `ToolCallState[]`. The implementer subagent can clean this up.)

- [ ] **Step 3: useTranscript — add `replayMessages` + `clear`**

```typescript
const replayMessages = useCallback((items: TranscriptItem[]): void => {
  setItems(items);
}, []);

const clear = useCallback((): void => {
  setItems([]);
}, []);

// add to return:
return { ..., replayMessages, clear };
```

- [ ] **Step 4: Tests for replay**

```typescript
import { describe, it, expect } from "vitest";
import { messagesToTranscript } from "../../src/lib/replay.js";

describe("messagesToTranscript", () => {
  it("converts user + assistant messages to transcript items", () => {
    const msgs = [
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
    ];
    const items = messagesToTranscript(msgs);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "user", text: "hi" });
    expect(items[1]).toMatchObject({ kind: "assistant", text: "hello", done: true });
  });

  it("summarizes tool_use blocks as completed tool calls", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "let me check" },
          { type: "tool_use", name: "file_read" },
        ],
      },
    ];
    const items = messagesToTranscript(msgs);
    expect(items[0]).toMatchObject({ kind: "assistant" });
    if (items[0]!.kind === "assistant") {
      expect(items[0]!.toolCalls).toHaveLength(1);
      expect(items[0]!.toolCalls[0]!.tool).toBe("file_read");
    }
  });

  it("skips malformed entries", () => {
    const items = messagesToTranscript([null, "string", { content: "not array" }]);
    expect(items).toHaveLength(0);
  });
});
```

- [ ] **Step 5: ReplMode — handle `/resume <id>`**

Append to slash-command intercept in `submit`:

```typescript
const resumeMatch = /^\/resume\s+(\S+)$/.exec(prompt);
if (resumeMatch !== null) {
  const id = resumeMatch[1]!;
  void (async () => {
    try {
      const session = await client.sessionLoad(id);
      const items = messagesToTranscript(session.messages);
      transcript.replayMessages(items);
      setSessionId(session.id);
      transcript.appendSystem("info", `resumed session ${session.id.slice(0, 8)}…`);
    } catch (e) {
      transcript.appendSystem("error", (e as Error).message);
    }
  })();
  return;
}
```

- [ ] **Step 6: Verify + commit**

```bash
pnpm test
pnpm typecheck
git add src/lib/replay.ts src/hooks/useTranscript.ts src/modes/ReplMode.tsx tests/lib/replay.test.ts
git commit -m "feat(tui): /resume <id> replays past session via session.load"
```

---

### Task 3: /sessions selectable modal

**Files:**
- Modify: `src/modes/ReplMode.tsx`

- [ ] **Step 1: Modal state**

Replace the existing `/sessions` handler that appends a system item with one that opens a modal:

```typescript
const [sessionsModal, setSessionsModal] = useState<{
  options: SelectOption[];
} | null>(null);

// In submit:
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
          label: s.id.slice(0, 12) + "…",
          hint: `${s.message_count} msgs · ${s.created_at.slice(0, 19)}`,
        })),
      });
    } catch (e) {
      transcript.appendSystem("error", (e as Error).message);
    }
  })();
  return;
}
```

- [ ] **Step 2: Render**

```tsx
{sessionsModal !== null && (
  <SelectModal
    title="resume session"
    options={sessionsModal.options}
    onSelect={(id) => {
      setSessionsModal(null);
      // Trigger /resume programmatically by reusing the resume code path:
      submit(`/resume ${id}`);
    }}
    onCancel={() => setSessionsModal(null)}
  />
)}
```

(`submit` is defined via useCallback; calling it from a callback closure is fine.)

- [ ] **Step 3: Verify + commit**

```bash
pnpm typecheck
git add src/modes/ReplMode.tsx
git commit -m "feat(tui): /sessions opens selectable SelectModal"
```

---

### Task 4: useBridgeClient.restart(newArgs)

**Files:**
- Modify: `src/hooks/useBridgeClient.ts`

- [ ] **Step 1: Expose restart**

The current hook spawns on mount and tears down on unmount. We need to also support imperative restart with new args while the component stays mounted.

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BridgeClient,
  ChildProcessTransport,
  ContentLengthFraming,
  NewlineFraming,
  type Framing,
} from "@meta-harney/bridge-client";
import type { CliArgs } from "../types.js";
import { locateBridge } from "../lib/locate-bridge.js";

export interface UseBridgeClientResult {
  client: BridgeClient | null;
  error: Error | null;
  ready: boolean;
  restart: (newArgs: CliArgs) => Promise<void>;
}

function buildBridgeArgs(args: CliArgs): string[] {
  const a = ["bridge"];
  if (args.provider) a.push("--provider", args.provider);
  if (args.profile) a.push("--profile", args.profile);
  if (args.model) a.push("--model", args.model);
  if (args.framing === "content-length") a.push("--framing", "content-length");
  if (args.yolo) a.push("--yolo");
  return a;
}

async function startClient(args: CliArgs): Promise<BridgeClient> {
  const framing: Framing =
    args.framing === "content-length" ? new ContentLengthFraming() : new NewlineFraming();
  const transport = new ChildProcessTransport({
    command: locateBridge(args.bridgeBin),
    args: buildBridgeArgs(args),
    framing,
  });
  const client = new BridgeClient({ transport });
  await client.start();
  await client.initialize({ clientInfo: { name: "oh-tui", version: "0.3.0" } });
  return client;
}

async function stopClient(client: BridgeClient): Promise<void> {
  try {
    await client.shutdown();
  } catch {
    /* may already be dead */
  }
  try {
    await client.exit();
  } catch {
    /* ditto */
  }
}

export function useBridgeClient(args: CliArgs): UseBridgeClientResult {
  const [client, setClient] = useState<BridgeClient | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [ready, setReady] = useState(false);
  const startedRef = useRef(false);
  const clientRef = useRef<BridgeClient | null>(null);

  // Initial mount
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let mounted = true;
    startClient(args)
      .then((c) => {
        if (!mounted) {
          void stopClient(c);
          return;
        }
        clientRef.current = c;
        setClient(c);
        setReady(true);
      })
      .catch((e: Error) => {
        if (mounted) setError(e);
      });
    return () => {
      mounted = false;
      const c = clientRef.current;
      if (c !== null) void stopClient(c);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const restart = useCallback(async (newArgs: CliArgs): Promise<void> => {
    setReady(false);
    const oldClient = clientRef.current;
    if (oldClient !== null) await stopClient(oldClient);
    clientRef.current = null;
    setClient(null);
    try {
      const newClient = await startClient(newArgs);
      clientRef.current = newClient;
      setClient(newClient);
      setReady(true);
    } catch (e) {
      setError(e as Error);
    }
  }, []);

  return { client, error, ready, restart };
}
```

- [ ] **Step 2: Verify + commit**

```bash
pnpm typecheck
git add src/hooks/useBridgeClient.ts
git commit -m "feat(tui): useBridgeClient.restart for mid-session bridge swap"
```

---

### Task 5: /provider /model /profile switching

**Files:**
- Modify: `src/modes/ReplMode.tsx`

Use `restart()` from T4 + `SelectModal` from T1.

- [ ] **Step 1: Provider switch**

```typescript
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

const [activeArgs, setActiveArgs] = useState<CliArgs>(args);
const [providerModal, setProviderModal] = useState<SelectOption[] | null>(null);

// In submit:
if (prompt === "/provider") {
  setProviderModal(PROVIDER_OPTIONS);
  return;
}

// Switch handler
const handleSwitchProvider = async (newProvider: string): Promise<void> => {
  setProviderModal(null);
  // Cancel inflight (if any) — restart will cleanly drop it anyway
  handleRef.current?.cancel().catch(() => {});
  transcript.appendSystem("info", `switching to ${newProvider}…`);
  const next = { ...activeArgs, provider: newProvider, model: null };
  setActiveArgs(next);
  try {
    await restart(next);
    // Reload session if we had one
    if (sessionId !== null && client !== null) {
      const session = await client.sessionLoad(sessionId);
      transcript.replayMessages(messagesToTranscript(session.messages));
    }
  } catch (e) {
    transcript.appendSystem("error", (e as Error).message);
  }
};
```

- [ ] **Step 2: Model switch**

For v1, hardcode a model list per provider (use the `hint` field from PROVIDER_OPTIONS or import the catalog data from `@meta-harney/bridge-client` if exposed). Simplest:

```typescript
const MODEL_OPTIONS: Record<string, string[]> = {
  anthropic: ["claude-sonnet-4-5", "claude-opus-4-5"],
  openai: ["gpt-4o", "gpt-4o-mini"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  moonshot: ["kimi-k2-0905-preview"],
  // ... etc
};

if (prompt === "/model") {
  const provider = activeArgs.provider ?? "deepseek";
  const models = MODEL_OPTIONS[provider] ?? [];
  if (models.length === 0) {
    transcript.appendSystem("info", `no known models for ${provider}`);
    return;
  }
  setModelModal(models.map((m) => ({ value: m, label: m })));
  return;
}
```

Same restart-and-reload flow on selection.

- [ ] **Step 3: Profile switch**

V1: just offer `["default", "work"]` hardcoded; users can do `oh auth login --profile work` separately:

```typescript
if (prompt === "/profile") {
  setProfileModal([
    { value: "default", label: "default" },
    { value: "work", label: "work", hint: "if you've logged in with --profile work" },
  ]);
  return;
}
```

(Future Phase 14 could query the backend for stored profiles, but oh-mini bridge doesn't expose `auth.list` yet.)

- [ ] **Step 4: Verify + commit**

```bash
pnpm typecheck
git add src/modes/ReplMode.tsx
git commit -m "feat(tui): /provider /model /profile switch via SelectModal + bridge restart"
```

---

### Task 6: TodoPanel for `todo_write` tool

**Files:**
- Create: `src/components/TodoPanel.tsx`
- Modify: `src/components/TranscriptItemView.tsx`
- Create: `tests/components/TodoPanel.test.tsx`

- [ ] **Step 1: Implementation**

```typescript
import type React from "react";
import { Box, Text } from "ink";

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface TodoPanelProps {
  todos: TodoItem[];
}

const ICON: Record<TodoItem["status"], string> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
};
const COLOR: Record<TodoItem["status"], "gray" | "yellow" | "green"> = {
  pending: "gray",
  in_progress: "yellow",
  completed: "green",
};

export function TodoPanel({ todos }: TodoPanelProps): React.JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} marginY={1}>
      <Text bold>plan</Text>
      {todos.map((t, i) => (
        <Box key={i}>
          <Text color={COLOR[t.status]}>{ICON[t.status]} </Text>
          <Text dimColor={t.status === "completed"} strikethrough={t.status === "completed"}>
            {t.content}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

export function parseTodos(args: unknown): TodoItem[] | null {
  if (typeof args !== "object" || args === null) return null;
  const todos = (args as { todos?: unknown }).todos;
  if (!Array.isArray(todos)) return null;
  const out: TodoItem[] = [];
  for (const t of todos) {
    if (typeof t !== "object" || t === null) continue;
    const item = t as { content?: unknown; status?: unknown };
    if (typeof item.content !== "string") continue;
    const status = item.status;
    if (status !== "pending" && status !== "in_progress" && status !== "completed") continue;
    out.push({ content: item.content, status });
  }
  return out.length > 0 ? out : null;
}
```

- [ ] **Step 2: Tests**

```typescript
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { TodoPanel, parseTodos } from "../../src/components/TodoPanel.js";

describe("TodoPanel", () => {
  it("renders todos with status icons", () => {
    const { lastFrame } = render(
      <TodoPanel
        todos={[
          { content: "step one", status: "completed" },
          { content: "step two", status: "in_progress" },
          { content: "step three", status: "pending" },
        ]}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("plan");
    expect(out).toContain("step one");
    expect(out).toContain("step two");
    expect(out).toContain("step three");
  });
});

describe("parseTodos", () => {
  it("extracts valid todos", () => {
    const todos = parseTodos({
      todos: [
        { content: "do thing", status: "pending" },
        { content: "done thing", status: "completed" },
      ],
    });
    expect(todos).toHaveLength(2);
  });

  it("rejects malformed shapes", () => {
    expect(parseTodos(null)).toBeNull();
    expect(parseTodos({})).toBeNull();
    expect(parseTodos({ todos: "not an array" })).toBeNull();
    expect(parseTodos({ todos: [{ content: 1 }] })).toBeNull();
  });
});
```

- [ ] **Step 3: Wire into TranscriptItemView**

In the assistant branch's tool-call rendering:

```typescript
{item.toolCalls.map((c) => {
  if (c.tool === "todo_write") {
    const todos = parseTodos(c.args);
    if (todos !== null) {
      return <TodoPanel key={c.invocationId} todos={todos} />;
    }
  }
  return <ToolCallView key={c.invocationId} call={c} />;
})}
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm test TodoPanel
pnpm typecheck
git add src/components/TodoPanel.tsx src/components/TranscriptItemView.tsx tests/components/TodoPanel.test.tsx
git commit -m "feat(tui): TodoPanel — render todo_write tool calls as plan with status icons"
```

---

### Task 7: ToolCallView 5-line truncation + --full-tool-output flag

**Files:**
- Modify: `src/types.ts` (add `fullToolOutput` to CliArgs)
- Modify: `src/cli.tsx` (parse `--full-tool-output`)
- Modify: `src/components/ToolCallView.tsx`
- Modify: `src/components/TranscriptItemView.tsx` (pass flag down)
- Modify: `src/modes/{One,Rep}lMode.tsx` (pass `args.fullToolOutput` through)

- [ ] **Step 1: CliArgs**

In `src/types.ts`, add `fullToolOutput: boolean` to CliArgs interface.

In `src/cli.tsx`, in `parseArgs`:

```typescript
} else if (a === "--full-tool-output") {
  args.fullToolOutput = true;
}
```

Initial default:
```typescript
fullToolOutput: false,
```

- [ ] **Step 2: ToolCallView**

```typescript
interface ToolCallViewProps {
  call: ToolCallState;
  fullOutput?: boolean;
}

export function ToolCallView({ call, fullOutput = false }: ToolCallViewProps): React.JSX.Element {
  // ... existing icon/color/args ...
  return (
    <Box flexDirection="column">
      <Box>{/* unchanged */}</Box>
      {call.status !== "running" && call.result !== undefined && call.result.length > 0 && (
        <Box marginLeft={2}>
          <Text dimColor>{formatResult(call.result, fullOutput)}</Text>
        </Box>
      )}
    </Box>
  );
}

function formatResult(result: string, full: boolean): string {
  if (full) return result;
  const lines = result.split("\n");
  if (lines.length <= 5 && result.length <= 500) return result;
  const head = lines.slice(0, 5).join("\n");
  const more = lines.length > 5
    ? ` … ${lines.length - 5} more lines`
    : ` …`;
  return head + more;
}
```

- [ ] **Step 3: Thread through**

In TranscriptItemView, accept `fullOutput?: boolean` prop and pass to ToolCallView.

In ReplMode/OneShotMode, pass `fullOutput={args.fullToolOutput}` when rendering TranscriptItemView (the Static rendering needs the prop on every render — that's fine, it's a stable value).

- [ ] **Step 4: Verify + commit**

```bash
pnpm typecheck
pnpm test
git add src/types.ts src/cli.tsx src/components/ToolCallView.tsx src/components/TranscriptItemView.tsx src/modes/ReplMode.tsx src/modes/OneShotMode.tsx
git commit -m "feat(tui): 5-line tool result truncation + --full-tool-output flag"
```

---

### Task 8: Markdown blockquote

**Files:**
- Modify: `src/lib/markdown.ts`
- Modify: `src/components/MarkdownText.tsx`
- Extend: `tests/components/MarkdownText.test.tsx` (rename existing tests/lib path if needed)

- [ ] **Step 1: tokenize**

Add to Token union:
```typescript
| { type: "blockquote"; text: InlineToken[] }
```

In tokenize() main loop, before the paragraph fallback:
```typescript
const quoteMatch = /^>\s*(.+)$/.exec(line);
if (quoteMatch !== null) {
  out.push({ type: "blockquote", text: tokenizeInline(quoteMatch[1]!) });
  i += 1;
  continue;
}
```

- [ ] **Step 2: Render in MarkdownText**

```typescript
if (tok.type === "blockquote") {
  return (
    <Box>
      <Text color="cyan">▎ </Text>
      <InlineRender tokens={tok.text} />
    </Box>
  );
}
```

- [ ] **Step 3: Test**

```typescript
it("recognizes blockquote", () => {
  const t = tokenize("> hello there");
  expect(t[0]).toMatchObject({ type: "blockquote" });
});
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm test
pnpm typecheck
git add src/lib/markdown.ts src/components/MarkdownText.tsx tests/components/MarkdownText.test.tsx
git commit -m "feat(tui): Markdown blockquote support (> text)"
```

---

### Task 9: Test + smoke pass

- [ ] **Run full suite**

```bash
pnpm typecheck
pnpm test
pnpm lint
```

Expected: ≥13 tests pass (9 existing + 3 SelectModal + 1 TodoPanel + 3 parseTodos + 3 replay + 1 markdown blockquote).

- [ ] **Manual smoke (user via TTY)**

Document in commit message or release notes:
- `oh-tui` REPL launches
- `/sessions` opens modal → arrow keys navigate → enter resumes
- `/resume <id>` directly loads
- `/provider` opens picker → select deepseek → bridge restarts, session preserved
- LLM call with `todo_write` tool → TodoPanel appears
- Long bash result → truncated to 5 lines; with `--full-tool-output` shows everything
- Markdown response with `> quote` line renders with ▎

- [ ] If failures arise from smoke, fix + commit.

---

### Task 10: v0.3.0 release

**Files:**
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Bump + README**

`package.json`: `"version": "0.3.0"`.

`README.md`: append section:

```markdown
## v0.3.0 — Session management + Agent visibility (Phase 13)

- `/resume <id>` loads past session and continues appending
- `/sessions` opens an arrow-key picker; select to resume
- `/provider` `/model` `/profile` open pickers that restart the bridge and re-load the current session
- TodoPanel: assistant's `todo_write` tool calls render as a structured plan
- Tool results truncate at 5 lines by default; pass `--full-tool-output` to disable
- Markdown blockquote (`> text`) support
```

- [ ] **Commit + tag + push**

```bash
git add package.json README.md
git commit -m "release: oh-tui v0.3.0 — Session management + Agent visibility (Phase 13)

A-side (session management):
- /resume <id> replays past session
- /sessions opens selectable modal
- /provider /model /profile bridge restart with session preservation

B-side (agent visibility):
- TodoPanel for todo_write tool calls
- 5-line tool result truncation (+ --full-tool-output to disable)
- Markdown blockquote support"

git tag -a v0.3.0 -m "v0.3.0 — Phase 13"
git push origin master
git push origin v0.3.0
```

---

## Self-Review

**Spec coverage:**
- ✅ /resume <id> (T2)
- ✅ /sessions selectable (T3)
- ✅ /provider /model /profile via SelectModal + restart (T4 + T5)
- ✅ TodoPanel (T6)
- ✅ Tool result truncation (T7)
- ✅ Markdown blockquote (T8)
- ✅ Tests (T1, T2, T6, T8)
- ✅ Release (T10)

**Placeholder scan:** T2's `summarizeTools` return type uses a complex conditional — implementer subagent can simplify to `ToolCallState[]` directly. Not a blocker.

**Type consistency:**
- `CliArgs.fullToolOutput: boolean` (T7) flows through cli.tsx → modes → TranscriptItemView → ToolCallView
- `useBridgeClient` now returns `{ client, error, ready, restart }` (T4) — both modes use the new shape
- `SelectModal` props unchanged across T1/T3/T5 — generic enough

**Risks:**
- T5 `/profile` is hardcoded to `["default", "work"]` — users with other profiles can use `--profile X` flag instead. Document this.
- T4 restart loses in-flight permission promises. Spec calls this out — implementer should cancel inflight before restart.
- T6 detection by `tool.name === "todo_write"` is brittle if the runtime renames the tool. Defensive fallback to ToolCallView is in place via `parseTodos` returning null.

All clear.

## Execution

Subagent-Driven. Batches:
- T1, T2 sequential (T1 has no dep; T2 depends on transcript hook from Phase 12 + needs T1 in scope for future modal hookup)
- T3 depends on T1+T2 (opens modal that triggers `/resume` via T2)
- T4 standalone (hooks change)
- T5 depends on T1 + T4
- T6, T7, T8 standalone — can run in any order after T1-T5
- T9 + T10 final
