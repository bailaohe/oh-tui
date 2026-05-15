# oh-tui

> An [Ink](https://github.com/vadimdemedes/ink)-powered terminal UI for the
> [oh-mini](https://github.com/bailaohe/oh-mini) coding agent — drives the
> meta-harney bridge over JSON-RPC with streaming output, permission gating,
> session management, and live telemetry.

[![License](https://img.shields.io/badge/license-Apache--2.0-green)](LICENSE)

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

- **CommandPicker**：输入 `/` 浮出补全菜单，↑↓ 选择、Tab 补全、Enter 提交、Esc 关闭
- **`/theme` 命令**：通过 SelectModal 切换 default/dark/minimal，立即生效
- **键位 1:1 对齐 OpenHarness**：
  - **Ctrl+C 单击 exit**（idle 时直接退出；busy 时取消正在运行的请求）—— **行为变更**：旧版需双击在 2 秒内才退出
  - 数字键 1-9 在 SelectModal 内快速选第 N 项
  - Esc 双击 500ms 内清空当前输入
- **PromptInput 重构**：value/onChange/onSubmit 受控；↑↓ history 移到 App.tsx
- **键位集中化**：App.tsx 单个 useInput 处理所有全局键位，互斥优先级清晰
- 删除 `src/hooks/useKeybinds.ts`（合并入 App.tsx）

## v0.4.0 — OpenHarness 1:1 visual refresh (Phase 14a)

- **单一 `App.tsx`**：`modes/ReplMode` 与 `OneShotMode` 二分消解；`oh-tui "hi"` 与 `--prompt "hi" --exit-on-done` 等价
- **主题系统**：`--theme default | dark | minimal`（`/theme` 命令在 14b 落地）
- **WelcomeBanner**：ASCII LOGO + 版本号 + 命令提示
- **TranscriptItem 扁平化**：`tool` / `tool_result` 升为顶层行，由 `invocationId` 显式配对；ConversationView 用 `<Static>` 切分已完成项 + 动态层
- **StatusBar 重做**：`─` 分隔线 + `│` 分隔段；按数据存在性动态展段；新增 tokens 段
- **Footer**：单行环境信息（model / provider / auth / yolo / session）
- **ToolCallDisplay**：替代 ToolCallView，配对 tool + tool_result 渲染

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
