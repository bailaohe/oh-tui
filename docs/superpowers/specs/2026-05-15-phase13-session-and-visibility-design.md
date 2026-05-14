# Phase 13 — Session management + Agent visibility

## Goal

Combine two themes into one phase:

**A. Session + provider management** — `/resume <id>`, selectable `/sessions`, `/provider /model /profile` mid-REPL switching.

**B. Agent intelligence visibility** — TodoPanel (parses `todo_write` tool calls), expandable tool results, Markdown blockquotes for richer assistant output.

After Phase 13 the user can: pick up old sessions, swap LLM provider/model without quitting, and *see* what the agent is planning and doing in real time.

## Background

- `/sessions` today is read-only inline list. User can see ids but can't select.
- `/resume` was promised in Phase 11 but never wired up — `session.load` exists in bridge but TUI doesn't call it.
- Bridge is spawned with `--provider X` at startup. To change provider, we must **respawn the bridge subprocess** with new args; sessions persist on disk so we can `session.load` after restart and keep the conversation alive.
- The `todo_write` tool ships todo lists as tool args. Currently they render as a generic ToolCallView — not as a structured plan. OpenHarness has a dedicated TodoPanel.
- Tool results today truncate at 200 chars — fine for short outputs, useless for big ones (file_read, grep, bash with multi-line stdout).

## Architecture

### A1. /resume — load + replay past messages

User types `/resume abc123…`. We:

1. If a bridge is active, keep it — `session.load(id)` works on the same bridge
2. Call `client.sessionLoad(id)` → `{id, created_at, messages: Message[]}`
3. Clear the current transcript
4. Replay each message as a transcript item:
   - `role: "user"` → `appendUser(text)`
   - `role: "assistant"` → `appendAssistant` + `appendToken(full_text)` + `finishAssistant`
5. Set `sessionId` state to the loaded id
6. Subsequent prompts append to this session

Messages have `content: ContentBlock[]` (text + tool_use + tool_result). For v1, only text blocks are rendered during replay; tool blocks are summarized as `[tool: name]` system info.

### A2. SessionListModal — selectable /sessions

Replaces today's inline transcript view of `/sessions`. When user types `/sessions`:

1. Call `client.sessionList()`
2. Open a `<SelectModal title="resume session" options={sessions.map(s => ({value: s.id, label: ...}))} />`
3. Arrow keys navigate, Enter selects, Esc cancels
4. On select → execute `/resume <id>` internally

### A3. Bridge restart for /provider /model /profile

`oh bridge` is launched with specific flags. To switch:

1. User picks new value via SelectModal (option list = `BUILT_IN_PROVIDERS` for /provider; current provider's known models for /model; locally-stored profiles for /profile)
2. Append system message `"switching to <new>..."`
3. Tear down current client (shutdown + exit + transport.stop)
4. Reset all session-related state but keep `sessionId` in a ref
5. Spawn new bridge with `--provider X` (or `--model X` / `--profile X`) — share existing HOME so sessions on disk are reachable
6. Initialize new client; if `sessionId` was set, immediately `client.sessionLoad(id)` to recover the conversation
7. Replay past messages into transcript (same as A1)

This means: switching provider mid-conversation preserves the session id and history. The new provider continues from where the old one left off. (LLM may behave inconsistently because the model differs — that's user's call.)

### B1. TodoPanel — parse todo_write tool calls

`todo_write` is a built-in oh-mini tool. Its `args` shape (per source code):

```typescript
{ todos: [{ content: string, status: "pending" | "in_progress" | "completed" }] }
```

When the assistant calls `todo_write`, we detect it in `tool_call_started` and render a `<TodoPanel todos={...}>` either:
- Inline in the assistant transcript item (replaces the regular `ToolCallView` for this specific tool), OR
- As a sticky right-side panel that updates as the agent's plan evolves

For v1: **inline render** — simpler, fits the transcript model, no Static-incompatibility issues. (Sticky right panel is a Phase 14 polish.)

### B2. Expandable tool results

ToolCallView currently truncates result at 200 chars. Phase 13:

1. When result > 5 lines or > 500 chars, render a collapsed view: first 3 lines + `… [press space to expand]`
2. Toggling expanded state via keystroke would require focus management — too involved for v1
3. **v1 compromise**: always show first 5 lines of the result, with `…` if more. Add a `--full-tool-output` CLI flag that disables truncation entirely. No expand/collapse interaction in v1.

### B3. Markdown blockquote

Add `> text` line support to `src/lib/markdown.ts`:

```typescript
| { type: "blockquote"; text: InlineToken[] }
```

Render as `<Box borderLeft borderColor="gray" paddingLeft={1}><InlineRender ... /></Box>` (Ink doesn't actually do partial borders; substitute with leading `▎` glyph).

## Module changes

```
src/
├── components/
│   ├── SelectModal.tsx          # NEW
│   ├── TodoPanel.tsx            # NEW
│   ├── ToolCallView.tsx         # MODIFY: 5-line + "…" truncation, honors --full-tool-output
│   ├── TranscriptItemView.tsx   # MODIFY: detect todo_write, render TodoPanel instead of ToolCallView
│   └── (existing components unchanged)
├── hooks/
│   ├── useBridgeClient.ts       # MODIFY: expose restart(newArgs) method
│   └── useTranscript.ts         # MODIFY: add replayMessages(msgs) helper
├── lib/
│   ├── markdown.ts              # MODIFY: blockquote support
│   └── replay.ts                # NEW: Message[] → transcript items helper
├── modes/
│   └── ReplMode.tsx             # MODIFY: /resume, /sessions modal, /provider/model/profile flows
├── types.ts                     # MODIFY: extend CliArgs with `fullToolOutput: boolean`
└── cli.tsx                      # MODIFY: parse --full-tool-output flag
```

## CLI surface additions

```
oh-tui [...existing] [--full-tool-output]
```

In REPL:
- `/resume <id>` — load past session by id
- `/sessions` — opens selectable modal (changed from inline list)
- `/provider` — opens provider picker; restarts bridge
- `/model` — opens model picker for current provider
- `/profile` — opens profile picker
- `/help` — (optional, list slash commands) — Phase 14

## Tests

| Test file | Coverage |
|---|---|
| `tests/components/SelectModal.test.tsx` | render options · arrow navigation · enter callback · esc cancel |
| `tests/components/TodoPanel.test.tsx` | render todo list · status icons (pending/in_progress/completed) |
| `tests/lib/replay.test.ts` | Message[] → TranscriptItem[] conversion |
| `tests/lib/markdown.test.ts` (extend) | blockquote tokenization |

## Acceptance

1. `/resume <id>` loads past session; messages render in transcript; subsequent prompts append correctly
2. `/sessions` opens modal; arrow + enter selects → triggers /resume
3. `/provider` opens modal listing 9 catalog providers; selecting one restarts bridge; current session_id preserved across restart
4. `/model` opens modal with current provider's models (hardcoded list per ProviderSpec for v1)
5. `/profile` opens modal with discovered profiles (from `auth list` data; v1 may just show "default" for simplicity)
6. Agent's `todo_write` call renders as TodoPanel with status icons, replacing the generic ToolCallView for that call
7. Tool results show first 5 lines + `…` if more, unless `--full-tool-output` set
8. Markdown `> quote` lines render with a leading `▎` glyph
9. `pnpm typecheck`, `pnpm test`, `pnpm lint` all clean
10. Manual smoke (TTY) verifies all 4 modal flows
11. Released as oh-tui v0.3.0

## Out of scope (Phase 14+)

- Expand/collapse keystrokes for tool results
- Sticky right-side TodoPanel
- Markdown tables, syntax-highlighted code blocks
- `/effort`, `/passes`, `/turns` hyperparameter switches (no current oh-mini support)
- `/theme`, `/vim`, `/voice`, WelcomeBanner (visual polish)
- SwarmPanel (multi-agent — depends on oh-mini exposing sub-agent CLI)
- `/help` command picker

## Risk callouts

- **Bridge restart races**: tearing down and respawning while a permission/request is in flight could deadlock. Mitigation: cancel any inflight handle BEFORE shutdown; reject pending permission promises with "switch cancelled".
- **Message replay vs Static dedupe**: replayed messages need stable ids. Use `replay-${idx}` to namespace.
- **Modal focus stealing**: SelectModal must capture keypresses without breaking PromptInput. Approach: render modal at top level, useInput inside modal returns early for non-arrow/enter/esc keys.
- **`todo_write` schema drift**: if oh-mini changes the tool schema later, TodoPanel breaks silently. Mitigation: defensive parsing — fall back to ToolCallView on shape mismatch.

## Versioning

oh-tui `0.2.0` → **`0.3.0`** (significant new commands + components).
