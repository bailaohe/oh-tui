# oh-tui

> An [Ink](https://github.com/vadimdemedes/ink)-powered terminal UI for the
> [oh-mini](https://github.com/bailaohe/oh-mini) coding agent — drives the
> meta-harney bridge over JSON-RPC with streaming output, permission gating,
> session management, and live telemetry.

[![License](https://img.shields.io/badge/license-Apache--2.0-green)](LICENSE)

## v0.3.1 — bug fix

- **Fix `/exit` hang**: `cli.tsx` now awaits `inst.waitUntilExit()` and
  drains the bridge subprocess via a module-level singleton (bounded 6s).
  Before this fix, `/exit` would unmount the React tree but the bridge
  child kept Node's event loop alive indefinitely.

## v0.3.0 — Session management + Agent visibility (Phase 13)

**A-side — Session management:**

- `/resume <id>` — replay a past session by id (via `session.load`)
- `/sessions` — opens a selectable modal listing past sessions; pick one to load
- `/provider <name>` / `/model <id>` / `/profile <name>` — switch on the fly via a `SelectModal`; bridge restarts with the new config and the current session is preserved
- `SelectModal` — arrow-key picker reused across pickers, `Esc` to cancel

**B-side — Agent visibility:**

- `TodoPanel` — renders `todo_write` tool calls as a live plan with status icons
- Tool result truncation — long tool outputs collapse to 5 lines by default; pass `--full-tool-output` to disable
- Markdown rendering — added blockquote (`> text`) support to `MarkdownText`

**Other:**

- Mid-session bridge swap via `useBridgeClient.restart`
- 19 component/unit tests covering the new surfaces

## v0.2.0 — polish + bug fixes

- Markdown rendering for assistant output (headings, lists, code blocks, bold/italic, inline code, links)
- ↑/↓ to recall previous prompts; current draft preserved when navigating back
- StatusBar at bottom showing provider/model/session/yolo + latest telemetry
- ToolCallView: multi-line tool invocations with args + result snippet
- Spinner during agent thinking
- Ctrl+C: cancels inflight, double-tap (within 2s) to exit when idle
- /sessions and /tools output now flows in the transcript, scrolls naturally
- Internally: transcript model + Ink Static for finished history (performance + correctness)

## What it is

`oh-tui` is the reference TUI built on top of
[`@meta-harney/bridge-client`](https://github.com/bailaohe/meta-harney/tree/main/clients/typescript).
It spawns the `oh` binary as a subprocess, speaks JSON-RPC 2.0 over stdio, and
renders streaming agent output (text, tool calls, permission prompts,
telemetry) in your terminal.

Two modes:

- **One-shot** — pass a prompt as args, see streaming output, exit when done.
- **REPL** — drop into an interactive prompt with multi-turn history,
  side panels for sessions/tools, and Ctrl+C cancellation.

## Install

oh-tui requires Node.js >= 18 and a working `oh` binary on `PATH` (or pass
`--bridge-bin /path/to/oh`).

```bash
# From source (recommended while v0.1.0 is fresh):
git clone https://github.com/bailaohe/oh-tui.git
cd oh-tui
pnpm install
pnpm start --help
```

Optionally symlink the launcher onto your `PATH`:

```bash
ln -s "$(pwd)/bin/oh-tui" /usr/local/bin/oh-tui
oh-tui --help
```

## Usage

### One-shot

Pass a prompt and let it stream the response:

```bash
oh-tui --provider deepseek --yolo "summarize this repo's README"
```

The TUI shows streaming text, tool call badges, and a final telemetry footer,
then exits.

### REPL

Omit the prompt to drop into interactive mode:

```bash
oh-tui --provider anthropic --model claude-sonnet-4-5
```

You get a persistent prompt, multi-turn conversation history, and access to
the slash commands below.

## Keyboard shortcuts and slash commands

| Input | Action |
|---|---|
| `/exit` | Quit the REPL cleanly |
| `/sessions` | Toggle the sessions side panel (list / load past sessions) |
| `/tools` | Toggle the tools side panel (browse available tool specs) |
| `Ctrl+C` | Cancel the in-flight send (fires `$/cancelRequest`); in REPL idle it does **not** kill the process — use `/exit` |
| `Enter` | Submit current prompt |

When a permission prompt appears (any tool that isn't whitelisted by
`--yolo`), use the on-screen `[a]llow / [d]eny` keys.

## CLI flags

```
oh-tui [prompt]                start one-shot if [prompt], else REPL

  --provider X                 provider name (anthropic, openai, deepseek, …)
  --profile P                  credentials profile (forwarded to bridge)
  --model M                    model override
  --framing F                  newline (default) | content-length
  --bridge-bin PATH            override path to the `oh` executable
  --yolo                       auto-approve all tool calls (skip dialogs)
  -h, --help                   show help and exit
  --version                    print version and exit
```

If `--bridge-bin` is omitted, `oh-tui` first tries `which oh`, then falls back
to a dev path (`/Users/baihe/Projects/study/oh-mini/.venv/bin/oh`) for local
development. Override explicitly in any production setting.

## Architecture (one paragraph)

`bin/oh-tui` execs `tsx src/cli.tsx`. The CLI parses argv, then `App.tsx`
routes to `OneShotMode` or `ReplMode` based on whether a prompt was passed.
`useBridgeClient` owns the bridge lifecycle (`initialize` → session create →
`sendMessage` streaming → `shutdown`). Streaming events render via Ink
components; `useCancelBinding` claims Ctrl+C while a send is in flight so it
cancels the request instead of killing the process.

## Development

```bash
pnpm install
pnpm typecheck       # tsc --noEmit
pnpm test            # vitest (component snapshots, hook tests)
pnpm start --help    # run the CLI directly via tsx

# Smoke test against the oh-mini fake provider:
OH_MINI_TEST_FAKE_PROVIDER=1 pnpm start --provider deepseek --yolo "hi"
```

## License

Apache-2.0
