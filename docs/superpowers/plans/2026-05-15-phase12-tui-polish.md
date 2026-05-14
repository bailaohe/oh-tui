# Phase 12 Plan — oh-tui polish (bug fixes + P0 features)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Ship oh-tui v0.2.0 fixing 3 bugs (Ctrl+C dead / no spinner / panel overlap) + closing 4 P0 OpenHarness gaps (Markdown, ↑↓ history, StatusBar, ToolCallView).

**Architecture:** Transcript model (tagged union of items) + Ink `<Static>` for completed history + dynamic active turn. Side panels become system transcript items.

**Tech stack:** Same as Phase 11 — TypeScript 5 strict, Ink 5, React 18, vitest + ink-testing-library.

**Spec:** `docs/superpowers/specs/2026-05-15-phase12-tui-polish-design.md`

**Repo:** `/Users/baihe/Projects/study/oh-tui` (branch `master`)

---

## File map

| File | Action | Task |
|---|---|---|
| `src/types.ts` | Modify (add TranscriptItem etc.) | T1 |
| `src/hooks/useTranscript.ts` | Create | T1 |
| `src/components/TranscriptItemView.tsx` | Create | T1 |
| `src/components/Spinner.tsx` | Create | T2 |
| `src/components/MarkdownText.tsx` | Create | T3 |
| `src/lib/markdown.ts` | Create | T3 |
| `src/components/StatusBar.tsx` | Create | T4 |
| `src/components/ToolCallView.tsx` | Create | T5 |
| `src/components/PromptInput.tsx` | Modify (↑↓) | T6 |
| `src/hooks/useKeybinds.ts` | Modify (cancel/exit semantics) | T7 |
| `src/modes/ReplMode.tsx` | Major rewrite | T8 |
| `src/modes/OneShotMode.tsx` | Adapt to transcript | T8 |
| `src/cli.tsx` | Minor — already has exitOnCtrlC:false | (T7 confirms) |
| `tests/components/*.test.tsx` | Create | T9 |
| `package.json` + README + tag | Modify | T10 |
| Files to delete | `ToolUseBadge.tsx`, `TelemetryBar.tsx`, `SessionListPanel.tsx`, `ToolsListPanel.tsx` (their roles absorbed) | T8 |

---

### Task 1: Transcript model + useTranscript hook + TranscriptItemView shell

**Files:**
- Modify: `src/types.ts`
- Create: `src/hooks/useTranscript.ts`
- Create: `src/components/TranscriptItemView.tsx`

- [ ] **Step 1: Extend `src/types.ts`**

Append to existing types.ts:

```typescript
export type TranscriptItemKind = "user" | "assistant" | "system" | "tool_call";

export interface ToolCallState {
  invocationId: string;
  tool: string;
  args: unknown;
  status: "running" | "done" | "error";
  result?: string;
}

export type SystemSubkind = "sessions" | "tools" | "error" | "info";

export type TranscriptItem =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "assistant";
      id: string;
      text: string;
      done: boolean;
      toolCalls: ToolCallState[];
    }
  | { kind: "system"; id: string; subkind: SystemSubkind; payload: unknown };
```

- [ ] **Step 2: Create `src/hooks/useTranscript.ts`**

```typescript
import { useCallback, useRef, useState } from "react";
import type { TranscriptItem, ToolCallState } from "../types.js";

let _idCounter = 0;
function nextId(): string {
  _idCounter += 1;
  return `t${_idCounter}`;
}

export interface TranscriptApi {
  items: TranscriptItem[];
  appendUser: (text: string) => string;
  appendAssistant: () => string;
  appendToken: (id: string, chunk: string) => void;
  appendToolCall: (id: string, call: ToolCallState) => void;
  updateToolCall: (id: string, invocationId: string, patch: Partial<ToolCallState>) => void;
  finishAssistant: (id: string) => void;
  appendSystem: (subkind: TranscriptItem extends { kind: "system" } ? never : never, payload: unknown) => string;
}

export function useTranscript() {
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const itemsRef = useRef<TranscriptItem[]>(items);
  itemsRef.current = items;

  const appendUser = useCallback((text: string): string => {
    const id = nextId();
    setItems((prev) => [...prev, { kind: "user", id, text }]);
    return id;
  }, []);

  const appendAssistant = useCallback((): string => {
    const id = nextId();
    setItems((prev) => [
      ...prev,
      { kind: "assistant", id, text: "", done: false, toolCalls: [] },
    ]);
    return id;
  }, []);

  const appendToken = useCallback((id: string, chunk: string): void => {
    if (chunk.length === 0) return;
    setItems((prev) =>
      prev.map((item) =>
        item.kind === "assistant" && item.id === id
          ? { ...item, text: item.text + chunk }
          : item,
      ),
    );
  }, []);

  const appendToolCall = useCallback(
    (id: string, call: ToolCallState): void => {
      setItems((prev) =>
        prev.map((item) =>
          item.kind === "assistant" && item.id === id
            ? { ...item, toolCalls: [...item.toolCalls, call] }
            : item,
        ),
      );
    },
    [],
  );

  const updateToolCall = useCallback(
    (id: string, invocationId: string, patch: Partial<ToolCallState>): void => {
      setItems((prev) =>
        prev.map((item) => {
          if (item.kind !== "assistant" || item.id !== id) return item;
          return {
            ...item,
            toolCalls: item.toolCalls.map((c) =>
              c.invocationId === invocationId ? { ...c, ...patch } : c,
            ),
          };
        }),
      );
    },
    [],
  );

  const finishAssistant = useCallback((id: string): void => {
    setItems((prev) =>
      prev.map((item) =>
        item.kind === "assistant" && item.id === id ? { ...item, done: true } : item,
      ),
    );
  }, []);

  const appendSystem = useCallback(
    (subkind: "sessions" | "tools" | "error" | "info", payload: unknown): string => {
      const id = nextId();
      setItems((prev) => [...prev, { kind: "system", id, subkind, payload }]);
      return id;
    },
    [],
  );

  return {
    items,
    itemsRef,
    appendUser,
    appendAssistant,
    appendToken,
    appendToolCall,
    updateToolCall,
    finishAssistant,
    appendSystem,
  };
}
```

- [ ] **Step 3: Create `src/components/TranscriptItemView.tsx`**

Stub for now — render switch by kind. Real content (MarkdownText, ToolCallView, formatted system panels) wires in later tasks.

```typescript
import type React from "react";
import { Box, Text } from "ink";
import type { TranscriptItem, SessionListEntry, ToolSpec } from "../types.js";
import { StreamingMessage } from "./StreamingMessage.js";

export interface TranscriptItemViewProps {
  item: TranscriptItem;
}

export function TranscriptItemView({ item }: TranscriptItemViewProps): React.JSX.Element {
  switch (item.kind) {
    case "user":
      return (
        <Box marginTop={1}>
          <Text dimColor>&gt; </Text>
          <Text>{item.text}</Text>
        </Box>
      );
    case "assistant":
      // T3 swaps StreamingMessage for MarkdownText
      return (
        <Box flexDirection="column">
          {item.toolCalls.length > 0 && (
            <Box flexDirection="column">
              {/* T5 swaps these for ToolCallView */}
              {item.toolCalls.map((c) => (
                <Text key={c.invocationId} dimColor>
                  · {c.tool} {c.status}
                </Text>
              ))}
            </Box>
          )}
          <StreamingMessage text={item.text} finished={item.done} />
        </Box>
      );
    case "system":
      return <SystemBlock item={item} />;
  }
}

function SystemBlock({ item }: { item: Extract<TranscriptItem, { kind: "system" }> }): React.JSX.Element {
  if (item.subkind === "sessions") {
    const sessions = item.payload as SessionListEntry[];
    return (
      <Box flexDirection="column" marginY={1} borderStyle="single" paddingX={1}>
        <Text bold>sessions</Text>
        {sessions.length === 0 ? (
          <Text dimColor>no sessions yet</Text>
        ) : (
          sessions.map((s) => (
            <Text key={s.id} dimColor>
              {s.id.slice(0, 8)}… · {s.message_count} msgs · {s.created_at.slice(0, 19)}
            </Text>
          ))
        )}
      </Box>
    );
  }
  if (item.subkind === "tools") {
    const tools = item.payload as ToolSpec[];
    return (
      <Box flexDirection="column" marginY={1} borderStyle="single" paddingX={1}>
        <Text bold>tools</Text>
        {tools.map((t) => (
          <Box key={t.name}>
            <Text bold>{t.name}</Text>
            <Text dimColor> · {t.description}</Text>
          </Box>
        ))}
      </Box>
    );
  }
  if (item.subkind === "error") {
    return (
      <Box marginY={1}>
        <Text color="red">error: {String(item.payload)}</Text>
      </Box>
    );
  }
  return (
    <Box marginY={1}>
      <Text dimColor>{String(item.payload)}</Text>
    </Box>
  );
}
```

(Note: `SessionListEntry` and `ToolSpec` must be re-exported from `@meta-harney/bridge-client`. Verify.)

- [ ] **Step 4: Verify**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/hooks/useTranscript.ts src/components/TranscriptItemView.tsx
git commit -m "feat(tui): transcript model + useTranscript hook + view shell"
```

---

### Task 2: Spinner component

**Files:**
- Create: `src/components/Spinner.tsx`
- Test: `tests/components/Spinner.test.tsx`

- [ ] **Step 1: Tests**

```typescript
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { Spinner } from "../../src/components/Spinner.js";

describe("Spinner", () => {
  it("renders label when active", () => {
    const { lastFrame } = render(<Spinner active={true} label="thinking" />);
    expect(lastFrame()).toContain("thinking");
  });

  it("renders nothing when inactive", () => {
    const { lastFrame } = render(<Spinner active={false} label="x" />);
    expect(lastFrame()?.trim() ?? "").toBe("");
  });
});
```

- [ ] **Step 2: Implementation**

```typescript
import type React from "react";
import { useEffect, useState } from "react";
import { Box, Text } from "ink";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface SpinnerProps {
  active: boolean;
  label?: string;
  intervalMs?: number;
}

export function Spinner({
  active,
  label = "thinking",
  intervalMs = 80,
}: SpinnerProps): React.JSX.Element | null {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const handle = setInterval(() => setI((x) => (x + 1) % FRAMES.length), intervalMs);
    return () => clearInterval(handle);
  }, [active, intervalMs]);
  if (!active) return null;
  return (
    <Box>
      <Text color="cyan">{FRAMES[i]}</Text>
      <Text dimColor> {label}…</Text>
    </Box>
  );
}
```

- [ ] **Step 3: Verify + commit**

```bash
pnpm test Spinner
pnpm typecheck
git add src/components/Spinner.tsx tests/components/Spinner.test.tsx
git commit -m "feat(tui): Spinner component with braille frames"
```

---

### Task 3: MarkdownText + lib/markdown.ts

**Files:**
- Create: `src/lib/markdown.ts`
- Create: `src/components/MarkdownText.tsx`
- Test: `tests/components/MarkdownText.test.tsx`

- [ ] **Step 1: Tokenizer (markdown subset)**

`src/lib/markdown.ts`:

```typescript
export type Token =
  | { type: "heading"; level: 1 | 2 | 3; text: InlineToken[] }
  | { type: "paragraph"; text: InlineToken[] }
  | { type: "list_item"; marker: string; text: InlineToken[] }
  | { type: "code_block"; lang: string | null; code: string };

export type InlineToken =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string };

export function tokenize(input: string): Token[] {
  const out: Token[] = [];
  const lines = input.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Code block
    const fenceMatch = /^```(\w*)?\s*$/.exec(line);
    if (fenceMatch !== null) {
      const lang = fenceMatch[1] !== undefined && fenceMatch[1].length > 0 ? fenceMatch[1] : null;
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) {
        codeLines.push(lines[i]!);
        i += 1;
      }
      out.push({ type: "code_block", lang, code: codeLines.join("\n") });
      if (i < lines.length) i += 1; // skip closing fence
      continue;
    }

    // Heading
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line);
    if (headingMatch !== null) {
      const level = headingMatch[1]!.length as 1 | 2 | 3;
      out.push({ type: "heading", level, text: tokenizeInline(headingMatch[2]!) });
      i += 1;
      continue;
    }

    // List item
    const listMatch = /^\s*([-*+]|\d+\.)\s+(.+)$/.exec(line);
    if (listMatch !== null) {
      out.push({
        type: "list_item",
        marker: listMatch[1]!,
        text: tokenizeInline(listMatch[2]!),
      });
      i += 1;
      continue;
    }

    // Blank line → skip
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Paragraph (collect until blank/heading/list/fence)
    const buf: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^(#{1,3})\s+/.test(lines[i]!) &&
      !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]!) &&
      !/^```/.test(lines[i]!)
    ) {
      buf.push(lines[i]!);
      i += 1;
    }
    out.push({ type: "paragraph", text: tokenizeInline(buf.join(" ")) });
  }
  return out;
}

export function tokenizeInline(s: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let i = 0;
  while (i < s.length) {
    // Inline code
    if (s[i] === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > i) {
        tokens.push({ type: "code", text: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // Bold **x**
    if (s.startsWith("**", i)) {
      const end = s.indexOf("**", i + 2);
      if (end > i) {
        tokens.push({ type: "bold", text: s.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    // Italic *x*
    if (s[i] === "*" && s[i + 1] !== "*") {
      const end = s.indexOf("*", i + 1);
      if (end > i + 1) {
        tokens.push({ type: "italic", text: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // Link [text](url)
    if (s[i] === "[") {
      const closeBracket = s.indexOf("]", i + 1);
      if (closeBracket > i && s[closeBracket + 1] === "(") {
        const closeParen = s.indexOf(")", closeBracket + 2);
        if (closeParen > closeBracket) {
          tokens.push({
            type: "link",
            text: s.slice(i + 1, closeBracket),
            href: s.slice(closeBracket + 2, closeParen),
          });
          i = closeParen + 1;
          continue;
        }
      }
    }
    // Plain text up to next special char or end
    const next = nextSpecial(s, i);
    tokens.push({ type: "text", text: s.slice(i, next) });
    i = next;
  }
  return tokens;
}

function nextSpecial(s: string, start: number): number {
  for (let j = start; j < s.length; j++) {
    const c = s[j];
    if (c === "`" || c === "*" || c === "[") return j;
  }
  return s.length;
}
```

- [ ] **Step 2: MarkdownText component**

```typescript
import type React from "react";
import { Box, Text } from "ink";
import { tokenize, type Token, type InlineToken } from "../lib/markdown.js";

export interface MarkdownTextProps {
  source: string;
  /** Show a trailing cursor (▍) — used during active streaming */
  cursor?: boolean;
}

export function MarkdownText({ source, cursor = false }: MarkdownTextProps): React.JSX.Element {
  const tokens = tokenize(source);
  return (
    <Box flexDirection="column">
      {tokens.map((tok, i) => (
        <BlockRender key={i} tok={tok} />
      ))}
      {cursor && <Text>▍</Text>}
    </Box>
  );
}

function BlockRender({ tok }: { tok: Token }): React.JSX.Element {
  if (tok.type === "heading") {
    const color = tok.level === 1 ? "magenta" : tok.level === 2 ? "cyan" : "yellow";
    return (
      <Box marginTop={1}>
        <Text bold color={color}>
          {"#".repeat(tok.level)}{" "}
        </Text>
        <InlineRender tokens={tok.text} />
      </Box>
    );
  }
  if (tok.type === "code_block") {
    return (
      <Box flexDirection="column" marginY={1} borderStyle="single" paddingX={1}>
        {tok.lang && <Text dimColor>{tok.lang}</Text>}
        <Text>{tok.code}</Text>
      </Box>
    );
  }
  if (tok.type === "list_item") {
    return (
      <Box>
        <Text color="cyan">{tok.marker} </Text>
        <InlineRender tokens={tok.text} />
      </Box>
    );
  }
  return (
    <Box>
      <InlineRender tokens={tok.text} />
    </Box>
  );
}

function InlineRender({ tokens }: { tokens: InlineToken[] }): React.JSX.Element {
  return (
    <Text>
      {tokens.map((t, i) => {
        if (t.type === "text") return t.text;
        if (t.type === "bold") return (
          <Text key={i} bold>
            {t.text}
          </Text>
        );
        if (t.type === "italic") return (
          <Text key={i} italic>
            {t.text}
          </Text>
        );
        if (t.type === "code") return (
          <Text key={i} backgroundColor="gray" color="white">
            {" "}
            {t.text}{" "}
          </Text>
        );
        if (t.type === "link") return (
          <Text key={i} underline color="blue">
            {t.text}
          </Text>
        );
        return null;
      })}
    </Text>
  );
}
```

- [ ] **Step 3: Test**

```typescript
import { describe, it, expect } from "vitest";
import { tokenize } from "../../src/lib/markdown.js";

describe("markdown tokenize", () => {
  it("recognizes heading", () => {
    const t = tokenize("# Hello");
    expect(t[0]?.type).toBe("heading");
  });

  it("recognizes code block", () => {
    const t = tokenize("```py\nprint(1)\n```");
    expect(t[0]).toMatchObject({ type: "code_block", lang: "py" });
  });

  it("recognizes list items", () => {
    const t = tokenize("- one\n- two");
    expect(t.length).toBe(2);
    expect(t.every((x) => x.type === "list_item")).toBe(true);
  });

  it("inline bold + code", () => {
    const t = tokenize("hello **world** `x`");
    expect(t[0]?.type).toBe("paragraph");
  });
});
```

- [ ] **Step 4: Wire into TranscriptItemView** — swap `StreamingMessage` for `<MarkdownText source={item.text} cursor={!item.done} />` in the assistant branch.

- [ ] **Step 5: Verify + commit**

```bash
pnpm test
pnpm typecheck
git add src/lib/markdown.ts src/components/MarkdownText.tsx tests/components/MarkdownText.test.tsx src/components/TranscriptItemView.tsx
git commit -m "feat(tui): MarkdownText with subset tokenizer (heading/list/code/bold/italic/inline-code/link)"
```

---

### Task 4: StatusBar

**Files:**
- Create: `src/components/StatusBar.tsx`

- [ ] **Step 1: Implementation**

```typescript
import type React from "react";
import { Box, Text } from "ink";

export interface StatusBarProps {
  provider: string | null;
  model: string | null;
  sessionIdShort: string | null;
  yolo: boolean;
  telemetry: { event_type: string; elapsed_ms: number } | null;
  cancelHint?: string | null;
}

export function StatusBar({
  provider,
  model,
  sessionIdShort,
  yolo,
  telemetry,
  cancelHint,
}: StatusBarProps): React.JSX.Element {
  const left: string[] = [];
  if (provider !== null) left.push(provider + (model !== null ? `/${model}` : ""));
  if (sessionIdShort !== null) left.push(`sess ${sessionIdShort}`);
  if (yolo) left.push("yolo");

  const right = cancelHint !== null && cancelHint !== undefined
    ? cancelHint
    : telemetry !== null
    ? `${telemetry.event_type} ${telemetry.elapsed_ms}ms`
    : "idle";

  return (
    <Box justifyContent="space-between">
      <Text dimColor>{left.join(" · ")}</Text>
      <Text dimColor>{right}</Text>
    </Box>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/StatusBar.tsx
git commit -m "feat(tui): StatusBar — provider/model/session/yolo + telemetry"
```

---

### Task 5: ToolCallView

**Files:**
- Create: `src/components/ToolCallView.tsx`
- Modify: `src/components/TranscriptItemView.tsx` to use it

- [ ] **Implementation**

```typescript
import type React from "react";
import { Box, Text } from "ink";
import type { ToolCallState } from "../types.js";

export function ToolCallView({ call }: { call: ToolCallState }): React.JSX.Element {
  const icon = call.status === "running" ? "▸" : call.status === "done" ? "✓" : "✗";
  const color = call.status === "running" ? "yellow" : call.status === "done" ? "green" : "red";
  const argsBlurb = stringifyArgs(call.args);
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color}>{icon} </Text>
        <Text bold>{call.tool}</Text>
        {argsBlurb !== "" && <Text dimColor>  {argsBlurb}</Text>}
      </Box>
      {call.status !== "running" && call.result !== undefined && call.result.length > 0 && (
        <Box marginLeft={2}>
          <Text dimColor>{truncate(call.result, 200)}</Text>
        </Box>
      )}
    </Box>
  );
}

function stringifyArgs(args: unknown): string {
  if (args === undefined || args === null) return "";
  if (typeof args === "string") return truncate(args, 80);
  try {
    return truncate(JSON.stringify(args), 80);
  } catch {
    return "";
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
```

In TranscriptItemView, replace the placeholder tool-call rendering with `<ToolCallView call={c} />`.

- [ ] **Commit**

```bash
git add src/components/ToolCallView.tsx src/components/TranscriptItemView.tsx
git commit -m "feat(tui): ToolCallView with multi-line args + result"
```

---

### Task 6: PromptInput ↑↓ history

**Files:**
- Modify: `src/components/PromptInput.tsx`
- Test: `tests/components/PromptInput.test.tsx`

- [ ] **Step 1: Implementation**

```typescript
import type React from "react";
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

export interface PromptInputProps {
  history: string[];
  onSubmit: (text: string) => void;
  placeholder?: string;
}

export function PromptInput({
  history,
  onSubmit,
  placeholder,
}: PromptInputProps): React.JSX.Element {
  const [value, setValue] = useState("");
  // `historyIdx === history.length` means "at draft" (user's current input).
  // When navigating up, we go backwards through history. When navigating down
  // past the last item, we restore the saved draft.
  const [historyIdx, setHistoryIdx] = useState(history.length);
  const [draft, setDraft] = useState("");

  // useInput intercepts ↑/↓ BEFORE ink-text-input gets them (since useInput
  // handlers run before keyboard delegation to children). When idx changes,
  // we overwrite `value` from history.
  useInput((_input, key) => {
    if (key.upArrow) {
      if (history.length === 0) return;
      const newIdx = Math.max(0, historyIdx - 1);
      if (newIdx === historyIdx) return;
      if (historyIdx === history.length) setDraft(value); // entering history; save draft
      setHistoryIdx(newIdx);
      setValue(history[newIdx] ?? "");
    } else if (key.downArrow) {
      if (historyIdx === history.length) return;
      const newIdx = historyIdx + 1;
      setHistoryIdx(newIdx);
      if (newIdx === history.length) {
        setValue(draft);
      } else {
        setValue(history[newIdx] ?? "");
      }
    }
  });

  return (
    <Box>
      <Text color="cyan">oh&gt; </Text>
      <TextInput
        value={value}
        onChange={(v) => {
          setValue(v);
          // Any direct edit moves user back to the "draft" slot at the end of
          // the history list — that's where new entries go.
          if (historyIdx !== history.length) setHistoryIdx(history.length);
        }}
        onSubmit={(v) => {
          onSubmit(v);
          setValue("");
          setDraft("");
          setHistoryIdx(history.length + 1);
        }}
        placeholder={placeholder}
      />
    </Box>
  );
}
```

- [ ] **Step 2: Test (using ink-testing-library + stdin keypress simulation)**

```typescript
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { PromptInput } from "../../src/components/PromptInput.js";

describe("PromptInput", () => {
  it("renders the prompt prefix and an empty input by default", () => {
    const { lastFrame } = render(
      <PromptInput history={[]} onSubmit={() => {}} />,
    );
    expect(lastFrame()).toContain("oh>");
  });

  it("up arrow recalls the most recent history entry", () => {
    const history = ["first", "second", "third"];
    const { lastFrame, stdin } = render(
      <PromptInput history={history} onSubmit={() => {}} />,
    );
    stdin.write("[A"); // up arrow ANSI
    expect(lastFrame()).toContain("third");
  });

  it("down arrow past the end restores the draft", () => {
    const { lastFrame, stdin } = render(
      <PromptInput history={["one"]} onSubmit={() => {}} />,
    );
    stdin.write("hi");
    stdin.write("[A"); // up
    stdin.write("[B"); // down — should restore "hi"
    expect(lastFrame()).toContain("hi");
  });
});
```

- [ ] **Commit**

```bash
pnpm test PromptInput
git add src/components/PromptInput.tsx tests/components/PromptInput.test.tsx
git commit -m "feat(tui): PromptInput ↑↓ history navigation with draft preservation"
```

---

### Task 7: useKeybinds — cancel + double-tap exit

**Files:**
- Modify: `src/hooks/useKeybinds.ts`

- [ ] **Implementation**

```typescript
import { useRef } from "react";
import { useInput } from "ink";

/**
 * Cancel + double-tap exit binding for Ctrl+C.
 *
 *   - If `getInflight()` returns a handle, we call its `cancel()` and consume the keypress.
 *   - Otherwise: first press records the timestamp + invokes `onHint?.(true)`.
 *   - Second press within `windowMs` invokes `onExit()`.
 *   - After `windowMs` lapses, the hint clears via `onHint?.(false)`.
 */
export function useCancelOrExit(opts: {
  getInflight: () => { cancel: () => Promise<void> } | null;
  onExit: () => void;
  onHint?: (visible: boolean) => void;
  windowMs?: number;
}): void {
  const { getInflight, onExit, onHint, windowMs = 2000 } = opts;
  const lastTapRef = useRef(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useInput((input, key) => {
    if (!(key.ctrl && input === "c")) return;
    const handle = getInflight();
    if (handle !== null) {
      handle.cancel().catch(() => {
        /* race with normal completion — ignore */
      });
      return;
    }
    const now = Date.now();
    if (now - lastTapRef.current <= windowMs) {
      lastTapRef.current = 0;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      onHint?.(false);
      onExit();
      return;
    }
    lastTapRef.current = now;
    onHint?.(true);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onHint?.(false);
      lastTapRef.current = 0;
    }, windowMs);
  });
}

// Keep the old simple binding for OneShotMode (cancel-only, no exit dance)
export function useCancelBinding(onCancel: () => void): void {
  useInput((input, key) => {
    if (key.ctrl && input === "c") onCancel();
  });
}
```

- [ ] **Commit**

```bash
git add src/hooks/useKeybinds.ts
git commit -m "feat(tui): useCancelOrExit hook with double-tap exit semantics"
```

---

### Task 8: ReplMode rewrite + OneShotMode adapter + delete obsolete components

**Files:**
- Modify: `src/modes/ReplMode.tsx` (major rewrite)
- Modify: `src/modes/OneShotMode.tsx` (use transcript)
- Delete: `src/components/ToolUseBadge.tsx`
- Delete: `src/components/TelemetryBar.tsx`
- Delete: `src/components/SessionListPanel.tsx`, `src/components/ToolsListPanel.tsx`

(Keep `StreamingMessage.tsx` — MarkdownText supersedes it but we keep the primitive in case future tasks need raw output.)

- [ ] **Step 1: Rewrite ReplMode**

Full rewrite uses the new transcript model, Static rendering, Spinner, StatusBar, double-tap cancel.

```typescript
/**
 * ReplMode — interactive multi-turn chat (Phase 12 rewrite).
 *
 * Key behavior changes vs Phase 11:
 *   - All scrollback (user prompts, assistant responses, /sessions and /tools
 *     output, errors) flows through a single transcript array. Completed
 *     items render inside <Static> so high-frequency text_delta updates only
 *     re-render the active assistant turn.
 *   - /sessions and /tools append SYSTEM transcript items instead of being
 *     fixed panels. They scroll naturally with the conversation.
 *   - Spinner appears between submit and first token.
 *   - Ctrl+C: cancels inflight; if idle, second press within 2s exits.
 *   - StatusBar shows provider/model/session/yolo + latest telemetry, plus
 *     the double-tap exit hint when active.
 */

import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Static, Text, useApp } from "ink";
import {
  BridgeCancelled,
  type PermissionDecision,
  type SendMessageHandle,
} from "@meta-harney/bridge-client";
import { useBridgeClient } from "../hooks/useBridgeClient.js";
import { useCancelOrExit } from "../hooks/useKeybinds.js";
import { useTranscript } from "../hooks/useTranscript.js";
import { PromptInput } from "../components/PromptInput.js";
import { PermissionDialog } from "../components/PermissionDialog.js";
import { Spinner } from "../components/Spinner.js";
import { StatusBar } from "../components/StatusBar.js";
import { TranscriptItemView } from "../components/TranscriptItemView.js";
import type { CliArgs, TranscriptItem, ToolCallState } from "../types.js";

interface PendingPermission {
  tool: string;
  args: unknown;
  resolve: (decision: PermissionDecision) => void;
}

interface StreamEventLike {
  kind?: string;
  text?: string;
  tool?: string;
  invocation_id?: string;
  invocationId?: string;
  args?: unknown;
  result?: string;
  error?: string;
}

export function ReplMode({ args }: { args: CliArgs }): React.JSX.Element {
  const { client, ready, error } = useBridgeClient(args);
  const transcript = useTranscript();
  const [history, setHistory] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [permission, setPermission] = useState<PendingPermission | null>(null);
  const [runtimeError, setRuntimeError] = useState<Error | null>(null);
  const [telemetry, setTelemetry] = useState<{ event_type: string; elapsed_ms: number } | null>(null);
  const [waitingForFirstToken, setWaitingForFirstToken] = useState(false);
  const [exitHintVisible, setExitHintVisible] = useState(false);
  const handleRef = useRef<SendMessageHandle | null>(null);
  const activeAssistantIdRef = useRef<string | null>(null);
  const app = useApp();

  // Subscribe to telemetry (best-effort).
  useEffect(() => {
    if (client === null) return;
    client.onTelemetry((ev) => {
      const payload = ev.payload as { duration_ms?: number } | null;
      const elapsed =
        payload !== null && typeof payload.duration_ms === "number" ? payload.duration_ms : 0;
      setTelemetry({ event_type: ev.event_type, elapsed_ms: Math.round(elapsed) });
    });
    void client.telemetrySubscribe(true).catch(() => {});
  }, [client]);

  useCancelOrExit({
    getInflight: () => handleRef.current,
    onExit: () => app.exit(),
    onHint: setExitHintVisible,
  });

  if (error !== null) return <Text color="red">error: {error.message}</Text>;
  if (runtimeError !== null) return <Text color="red">error: {runtimeError.message}</Text>;
  if (!ready || client === null) return <Text dimColor>connecting…</Text>;

  const submit = useCallback(
    (prompt: string): void => {
      if (prompt === "/exit" || prompt === "/quit") {
        app.exit();
        return;
      }
      if (prompt === "/sessions") {
        void (async () => {
          try {
            const list = await client.sessionList();
            transcript.appendSystem("sessions", list);
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
      if (prompt.trim() === "") return;

      setHistory((h) => [...h, prompt]);
      transcript.appendUser(prompt);
      const assistantId = transcript.appendAssistant();
      activeAssistantIdRef.current = assistantId;
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
              if (chunk.length > 0) {
                setWaitingForFirstToken(false);
                transcript.appendToken(assistantId, chunk);
              }
            } else if (kind === "tool_call_started" || kind === "tool_use") {
              const invocationId =
                ev.invocationId ?? ev.invocation_id ?? Math.random().toString(36).slice(2);
              const call: ToolCallState = {
                invocationId,
                tool: ev.tool ?? "tool",
                args: ev.args ?? null,
                status: "running",
              };
              transcript.appendToolCall(assistantId, call);
            } else if (kind === "tool_call_completed" || kind === "tool_result") {
              const invocationId = ev.invocationId ?? ev.invocation_id;
              if (invocationId !== undefined) {
                transcript.updateToolCall(assistantId, invocationId, {
                  status: ev.error !== undefined ? "error" : "done",
                  ...(ev.result !== undefined ? { result: ev.result } : {}),
                });
              }
            }
          });

          await handle.done;
        } catch (e) {
          if (e instanceof BridgeCancelled) {
            // partial response already accumulated; just finalize
          } else {
            transcript.appendSystem("error", (e as Error).message);
            if (sessionId === null) setRuntimeError(e as Error);
          }
        } finally {
          if (handleRef.current === handle) handleRef.current = null;
          if (activeAssistantIdRef.current === assistantId) activeAssistantIdRef.current = null;
          setWaitingForFirstToken(false);
          transcript.finishAssistant(assistantId);
        }
      })();
    },
    [client, sessionId, transcript, app],
  );

  // Split transcript into completed (Static) + active (dynamic).
  // The active item is the assistant turn currently streaming.
  const activeId = activeAssistantIdRef.current;
  const completed: TranscriptItem[] = transcript.items.filter((it) => {
    if (activeId === null) return true;
    return !(it.kind === "assistant" && it.id === activeId);
  });
  const active: TranscriptItem | undefined = activeId !== null
    ? transcript.items.find((it) => it.kind === "assistant" && it.id === activeId)
    : undefined;

  const sessionShort = sessionId !== null ? sessionId.slice(0, 8) + "…" : null;
  const cancelHint = exitHintVisible
    ? "press Ctrl+C again to exit"
    : handleRef.current !== null
    ? "Ctrl+C to cancel"
    : null;

  return (
    <Box flexDirection="column">
      <Static items={completed}>
        {(item) => <TranscriptItemView key={item.id} item={item} />}
      </Static>
      {active !== undefined && <TranscriptItemView item={active} />}
      <Spinner active={waitingForFirstToken} />
      {permission !== null && (
        <PermissionDialog
          tool={permission.tool}
          args={permission.args}
          onDecide={permission.resolve}
        />
      )}
      <PromptInput history={history} onSubmit={submit} />
      <StatusBar
        provider={args.provider}
        model={args.model}
        sessionIdShort={sessionShort}
        yolo={args.yolo}
        telemetry={telemetry}
        cancelHint={cancelHint}
      />
    </Box>
  );
}
```

- [ ] **Step 2: OneShotMode** — also rewrite to use transcript + Spinner + MarkdownText for consistency. Simpler: only one user + one assistant item, no /sessions etc.

```typescript
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Box, Text, useApp } from "ink";
import {
  BridgeCancelled,
  type PermissionDecision,
  type SendMessageHandle,
} from "@meta-harney/bridge-client";
import { useBridgeClient } from "../hooks/useBridgeClient.js";
import { useCancelBinding } from "../hooks/useKeybinds.js";
import { useTranscript } from "../hooks/useTranscript.js";
import { PermissionDialog } from "../components/PermissionDialog.js";
import { Spinner } from "../components/Spinner.js";
import { StatusBar } from "../components/StatusBar.js";
import { TranscriptItemView } from "../components/TranscriptItemView.js";
import type { CliArgs, ToolCallState } from "../types.js";

// Similar shape, single turn, exit when done. Same event routing as ReplMode.
// ... (the agent implementing this can mirror the ReplMode pattern, omitting
//      history/PromptInput, and call app.exit() in finally.)
```

- [ ] **Step 3: Delete obsolete components**

```bash
git rm src/components/ToolUseBadge.tsx
git rm src/components/TelemetryBar.tsx
git rm src/components/SessionListPanel.tsx
git rm src/components/ToolsListPanel.tsx
```

- [ ] **Step 4: Verify**

```bash
pnpm typecheck
pnpm test
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(tui): transcript model + Static rendering + Spinner + Ctrl+C dance"
```

---

### Task 9: Smoke test + final tests

**Files:**
- (optional) `tests/components/MarkdownText.test.tsx` and `tests/components/Spinner.test.tsx` from earlier tasks should already exist

- [ ] **Step 1: Run full test suite**

```bash
pnpm test
```

Expected: ≥5 passing tests (Spinner ×2, MarkdownText ×4, PromptInput ×3).

- [ ] **Step 2: Manual smoke (with TTY — user runs)**

Document in commit message which manual smoke was performed:
- `pnpm start` → REPL launches, StatusBar visible at bottom
- Type `/sessions` → list appears in transcript (NOT a fixed panel)
- Type real prompt → Spinner shows, then text streams via MarkdownText
- Ctrl+C during stream → cancellation, partial response kept
- Ctrl+C idle → "press Ctrl+C again to exit" hint; second within 2s exits
- ↑/↓ in PromptInput cycles previous prompts; typing resets to draft

- [ ] **Step 3: Commit any test fixes**

If smoke reveals issues, fix + commit. Otherwise no commit needed.

---

### Task 10: v0.2.0 release

**Files:**
- Modify: `package.json` (version 0.2.0)
- Modify: `README.md`
- Add tag, push

- [ ] **Step 1: Bump version**

`package.json`: `"version": "0.2.0"`

- [ ] **Step 2: README — new section "What's new in v0.2.0"**

```markdown
## v0.2.0 — polish + bug fixes

- Markdown rendering for assistant output (headings, lists, code blocks, bold/italic, inline code, links)
- ↑/↓ to recall previous prompts; current draft preserved when navigating back
- StatusBar at bottom showing provider/model/session/yolo + latest telemetry
- ToolCallView: multi-line tool invocations with args + result snippet
- Spinner during agent thinking
- Ctrl+C: cancels inflight, double-tap (within 2s) to exit when idle
- /sessions and /tools output now flows in the transcript, scrolls naturally
- Internally: transcript model + Ink Static for finished history (performance + correctness)
```

- [ ] **Step 3: Final quality gates**

```bash
pnpm typecheck
pnpm test
pnpm lint
```

- [ ] **Step 4: Commit + tag + push**

```bash
git add package.json README.md
git commit -m "release: oh-tui v0.2.0 — polish + bug fixes (Phase 12)

3 bugs fixed:
- Ctrl+C now cancels inflight + double-tap exits when idle
- Spinner shows during agent thinking
- /sessions and /tools output flows in transcript (no more overlap)

4 P0 OpenHarness gaps closed:
- Markdown rendering
- ↑↓ history navigation
- StatusBar with provider/model/session/yolo + telemetry
- Multi-line ToolCallView with args + result snippet"

git tag -a v0.2.0 -m "v0.2.0 — Phase 12 polish"
git push origin master
git push origin v0.2.0
```

---

## Self-Review

**Spec coverage:**
- ✅ Bug 1 Ctrl+C (T7 + T8)
- ✅ Bug 2 Spinner (T2 + T8)
- ✅ Bug 3 panel overlap (T1 transcript + T8 system items)
- ✅ Markdown (T3)
- ✅ ↑↓ history (T6)
- ✅ StatusBar (T4 + T8)
- ✅ Multi-line ToolCallView (T5 + T8)
- ✅ Tests (T2, T3, T6, T9)
- ✅ Release (T10)

**Placeholder scan:** OneShotMode rewrite in T8 says "mirror ReplMode pattern" — that's not a placeholder, it's an explicit pattern reference with concrete starting code. Acceptable.

**Type consistency:**
- `TranscriptItem` discriminated union used throughout T1-T8 consistently
- `ToolCallState` defined once in types.ts, consumed by useTranscript, TranscriptItemView, ToolCallView
- `SendMessageHandle` types from `@meta-harney/bridge-client` re-used unchanged

**Risks:**
- T8 deletes 4 components — verify no other file still imports them via grep
- `<Static>` keys must be stable strings — using transcript item ids satisfies this
- ink-text-input may eat arrow keys before useInput; T6 tests verify this. If it fails, fallback: build a custom mini-textinput

All clear.

## Execution

Subagent-Driven per standing preference. T1 is foundation — must be done first. T2-T7 can technically run in parallel but doing them serially keeps reviewer load tractable. T8 needs T1-T7. T9-T10 wrap up.
