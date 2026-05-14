# Phase 12 — oh-tui polish: bug fixes + OpenHarness P0 features

## Goal

Close the three reported bugs and the highest-impact OpenHarness gaps so oh-tui v0.2.0 feels like a real product:

| Reported bug | Root cause |
|---|---|
| Ctrl+C 不响应 | `exitOnCtrlC: false` + cancel-only handler → idle keystroke is a no-op |
| 无 spinner / 无流式视觉 | 缺 Spinner 组件；高频 setState 被 React 18 batch 成单帧 |
| /sessions /tools 错位 | 面板渲染在 turns 数组之后、PromptInput 之前；后续 turn 加入数组后视觉上盖在面板之上 |

| OpenHarness P0 缺口 | 现状 |
|---|---|
| Markdown 渲染 | 当前纯文本 |
| ↑↓ 历史召回 | 仅 `history` prop 占位，未接 |
| StatusBar 信息 | 仅 1 行 telemetry |
| ToolCallDisplay 多行 | 单行 badge |

## Architecture: transcript model + Static rendering

核心重构：把当前 `turns: Turn[]` 改为 `transcript: TranscriptItem[]`，并用 Ink `<Static>` 包裹"已完成"的条目避免高频 re-render。

```ts
type TranscriptItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string; done: boolean; toolCalls: ToolCall[] }
  | { kind: "system"; id: string; subkind: "sessions" | "tools" | "error" | "info"; payload: unknown }
  | { kind: "tool_call"; id: string; tool: string; args: unknown; status: "running" | "done" | "error"; result?: string };

interface ToolCall {
  invocationId: string;
  tool: string;
  args: unknown;
  status: "running" | "done" | "error";
  result?: string;
}
```

### Rendering layout

```tsx
<Box flexDirection="column">
  <Static items={completedItems}>
    {(item) => <TranscriptItemView key={item.id} item={item} />}
  </Static>
  {activeItem !== null && <TranscriptItemView item={activeItem} />}
  {permission !== null && <PermissionDialog .../>}
  <Spinner active={isWaitingForFirstToken} />
  <PromptInput ... />
  <StatusBar ... />
</Box>
```

- `completedItems` = transcript items where `done === true` (assistant) or kind ≠ assistant
- `activeItem` = current streaming assistant turn (re-renders frequently)
- `<Static>` ensures finished history doesn't re-render on every text_delta — fixes both perf and the panel-overlap bug because everything is in one chronological flow

### /sessions, /tools as system transcript items

```tsx
case "sessions": run rpc → append system item with subkind:"sessions", payload: SessionListEntry[]
case "tools":    run rpc → append system item with subkind:"tools", payload: ToolSpec[]
```

`<TranscriptItemView>` for `system + sessions` renders the same content as today's `SessionListPanel` but as part of scrollback. The user sees their `/sessions` call sit in history between their previous and next prompts — natural chronological flow.

## Components to add or upgrade

| Component | Status | Phase 12 |
|---|---|---|
| `<Spinner>` | Missing | Add. Braille frames `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`, 80ms cycle, "thinking..." label |
| `<MarkdownText>` | Missing | New. Subset: heading, bold, italic, inline code, code block, list, link. Use lightweight tokenizer (NOT pull in `marked` — overkill for our subset) |
| `<StatusBar>` | Replaces TelemetryBar | Single line: `{provider}/{model} · sess {id_short} · {yolo? "yolo " : ""}{telemetry?}` |
| `<ToolCallView>` | Replaces ToolUseBadge | Multi-line: icon + tool name + args (truncated), then result snippet when done |
| `<PromptInput>` | Upgrade | Intercept ↑/↓ via `useInput` before ink-text-input; maintain `historyIndex`; restore current draft on first ↓-past-end |
| `<TranscriptItemView>` | New | Renders any item kind via switch |

## Behavior changes

### Ctrl+C semantics (OpenHarness-style)

```
inflight → cancel current handle
no inflight + lastCtrlCAt within 2s → app.exit()
no inflight + cold → show transient hint "press Ctrl+C again within 2s to exit"
```

Track `lastCtrlCAt: number` in ReplMode. Hint shown via short-lived system transcript item or inline footer message.

### Streaming render

The "no streaming" perception comes from React 18 auto-batching setState in async callbacks. Approach:

1. **Don't fight batching** — natural batching is fine for long streams. For short responses (sub-500ms total), it visually arrives as one chunk anyway.
2. **Show Spinner immediately** so even short responses display _something_ between submit and first token.
3. **Static separation** ensures only the active turn re-renders, not the whole tree.

If batching genuinely hurts (verified via testing with longer prompts), fallback option: drive setState via `setTimeout(fn, 0)` to force a yield. Don't preempt with `flushSync` (causes layout thrash in Ink).

## Files

```
src/
├── components/
│   ├── Spinner.tsx            # NEW
│   ├── MarkdownText.tsx       # NEW
│   ├── StatusBar.tsx          # NEW (replaces TelemetryBar usage)
│   ├── ToolCallView.tsx       # NEW (replaces ToolUseBadge)
│   ├── TranscriptItemView.tsx # NEW
│   ├── PromptInput.tsx        # MODIFY (↑↓ history)
│   ├── PermissionDialog.tsx   # unchanged
│   ├── SessionListPanel.tsx   # CHANGE: rendered inside transcript, not as fixed panel
│   ├── ToolsListPanel.tsx     # CHANGE: same
│   ├── StreamingMessage.tsx   # SUPERSEDED by MarkdownText (kept as primitive for raw mode)
│   ├── ToolUseBadge.tsx       # DELETE
│   └── TelemetryBar.tsx       # DELETE (StatusBar absorbs it)
├── modes/
│   ├── OneShotMode.tsx        # MODIFY: use transcript model
│   └── ReplMode.tsx           # MODIFY: full rewrite around transcript + Static + Ctrl+C
├── hooks/
│   ├── useTranscript.ts       # NEW: state + append helpers
│   └── useCancelBinding       # MODIFY: support exit-on-double-tap
├── cli.tsx                    # MODIFY: keep exitOnCtrlC: false; double-tap implemented in mode
└── lib/
    └── markdown.ts            # NEW: minimal tokenizer + types
tests/
├── components/
│   ├── Spinner.test.tsx       # NEW
│   ├── MarkdownText.test.tsx  # NEW
│   └── PromptInput.test.tsx   # NEW (↑↓ behavior)
```

## Out of scope (deferred to Phase 13+)

- Themes / `/theme` switch
- `/provider`, `/model`, `/effort` SelectModal
- SwarmPanel (multi-agent visualization — needs runtime CLI support first)
- TodoPanel (needs to render `todo_write` tool calls specially — deferred until tool-call rendering is solid)
- Vim mode / voice mode
- WelcomeBanner (cosmetic, no functional value)
- /resume actually switching session (needs to drop current session + create new one with `session.load`)

These get a Phase 13 if user wants them.

## Acceptance

1. Ctrl+C with no inflight prompts "press Ctrl+C again within 2s to exit"; second press exits cleanly
2. Ctrl+C with inflight cancels the current turn; partial response preserved in transcript
3. Spinner visible from submit until first text_delta arrives, then disappears
4. /sessions output appears as a transcript message that scrolls naturally with subsequent chat — no overlap
5. /tools same as /sessions
6. ↑/↓ in PromptInput recalls previous prompts; current draft preserved when navigating back to end
7. Markdown content from LLM (headings, bold, code blocks, lists, inline code) renders styled
8. StatusBar shows provider, model, session id (truncated), yolo flag, current telemetry event
9. ToolCallView shows tool name + args + (when done) result snippet
10. `pnpm typecheck` clean; `pnpm test` ≥5 passing tests
11. Manual smoke: REPL + /sessions + /tools + Ctrl+C all behave correctly
12. Release as `oh-tui v0.2.0`, push to GitHub

## Versioning

`oh-tui` 0.1.0 → **0.2.0** (significant UX overhaul + bug fixes).
`@meta-harney/bridge-client` unchanged.

## Risk callouts

- **Static + dynamic item key collisions**: Ink's Static dedupes by key. Use stable id per transcript item (uuid or counter).
- **Markdown tokenizer rabbit hole**: bound it. Subset is fixed; anything outside renders as plain text.
- **ink-text-input swallows arrow keys**: must use `useInput` ABOVE ink-text-input to intercept before delegation. Test this works.
