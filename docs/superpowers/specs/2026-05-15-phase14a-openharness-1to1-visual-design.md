# Phase 14a — OpenHarness 1:1 视觉还原（框架重写）

## Goal

把 oh-tui 从 `modes/ReplMode + OneShotMode` 二分重构为 **OpenHarness 风格的单一 App**，并落地视觉层：主题系统、WelcomeBanner、ConversationView（顶层 tool/tool_result 配对）、StatusBar 重做、Footer。**不**做命令补全、性能优化、SidePanel —— 那是 14b/14c 的事。

发布版本：v0.3.3 → **v0.4.0**。

## Why split 14a / 14b / 14c

OpenHarness `frontend/terminal/` 总 2631 行 src，包含主题、命令补全、modal 管理、性能缓冲、侧栏等多个独立子系统。一次性全做风险大、plan 长，因此分三组：

- **14a 框架重写**（本 spec）：架构 + 视觉骨架
- **14b 交互**：CommandPicker + Tab 补全 + Esc 双击 + 数字键 + Ctrl+C 行为对齐 + `/theme` 命令
- **14c 性能与侧栏**：delta buffering + useDeferredValue + SidePanel + TodoPanel markdown 数据源对接

## Scope decisions

### 1:1 范围（已与用户对齐）

- **视觉 + 交互**层 1:1 OpenHarness；功能层面**砍不能做的**进下一 phase 待办清单
- **不改协议** — oh-mini bridge 仍是 JSON-RPC 2.0，不切到 OpenHarness 的 `OHJSON:` 行协议
- **不改后端** — oh-mini 不动；UI 适配工作全在 oh-tui 内部

### 永久砍掉（不进任何后续 phase）

| 项 | 原因 |
|---|---|
| SwarmPanel | swarm/coordinator 后端在 oh-mini 不存在 |
| /permissions /plan permission_mode 系统 | oh-mini 没有 permission_mode 概念 |
| /vim /voice | 无后端 |
| /effort /passes /turns | oh-mini 不暴露 reasoning 配置 |
| /output-style codex 模式 | 无后端 |
| Mcp/Bridge 状态计数 | 无数据源 |
| shift+enter 多行输入 | ink-text-input 原生不支持 |

### 进 14b/14c 待办

| 项 | 归属 |
|---|---|
| CommandPicker / slash 补全 | 14b |
| Tab 补全 / 数字键快选 | 14b |
| Esc 双击清输入 | 14b |
| Ctrl+C 行为换成 OpenHarness 单击 exit | 14b（与现 double-tap 冲突，需重设）|
| `/theme` 切换命令 | 14b |
| assistant delta 50ms/384 chars buffering | 14c |
| `useDeferredValue` 优化 | 14c |
| SidePanel（status/tasks/commands 侧栏）| 14c |
| TodoPanel 接收 markdown 字符串（OpenHarness 风格） | 14c（需 oh-mini bridge 改）|

## 节 1 — 架构骨架

### 文件变更

```
src/
├── App.tsx                       重写 (18 → ~400 行)，吸收 ReplMode/OneShotMode 逻辑
├── cli.tsx                       小改：parse --prompt（initial_prompt）、--exit-on-done、--theme
├── theme/
│   ├── builtinThemes.ts          新建：ThemeConfig + default/dark/minimal
│   └── ThemeContext.tsx          新建：Provider + useTheme()
├── components/
│   ├── WelcomeBanner.tsx         新建：oh-tui ASCII LOGO + version + hints
│   ├── ConversationView.tsx      新建：分组渲染（Static + 动态 + tool 配对）
│   ├── ToolCallDisplay.tsx       新建：替代 ToolCallView，配对 tool + tool_result
│   ├── StatusBar.tsx             改写：分隔符样式 │ + token 段
│   ├── Footer.tsx                新建：单行环境信息
│   ├── TranscriptItemView.tsx    删除（拆入 ConversationView + ToolCallDisplay）
│   ├── ToolCallView.tsx          删除（→ ToolCallDisplay）
│   ├── StreamingMessage.tsx      删除（MarkdownText 已取代）
│   ├── MarkdownText.tsx          保留，14a 内补 useTheme
│   ├── SelectModal.tsx           保留
│   ├── Spinner.tsx               保留，14a 内补 useTheme（icons.spinner）
│   ├── PromptInput.tsx           保留
│   ├── PermissionDialog.tsx      保留
│   └── TodoPanel.tsx             保留，14a 内补 useTheme
├── hooks/
│   ├── useTranscript.ts          改写：role 模型对齐（user/assistant/tool/tool_result/system）
│   ├── useBridgeClient.ts        保留
│   └── useKeybinds.ts            保留（14b 重做）
├── modes/                        整个目录删除
│   ├── OneShotMode.tsx           删除
│   └── ReplMode.tsx              删除
├── lib/
│   ├── locate-bridge.ts          保留
│   ├── markdown.ts               保留
│   └── replay.ts                 改：从 ContentBlock 展开为 tool/tool_result 顶层项
└── types.ts                      改：TranscriptItem 新模型
```

### App.tsx 顶层结构

```typescript
function App({ args }: { args: CliArgs }): React.JSX.Element {
  return (
    <ThemeProvider initialTheme={args.theme}>
      <AppInner args={args} />
    </ThemeProvider>
  );
}

function AppInner({ args }: { args: CliArgs }) {
  const { client, ready, error } = useBridgeClient(args);
  const transcript = useTranscript();
  const [history, setHistory] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [permission, setPermission] = useState<PendingPermission | null>(null);
  const [runtimeError, setRuntimeError] = useState<Error | null>(null);
  const [telemetry, setTelemetry] = useState(null);
  const [waitingForFirstToken, setWaitingForFirstToken] = useState(false);
  const [exitHintVisible, setExitHintVisible] = useState(false);
  const handleRef = useRef<SendMessageHandle | null>(null);
  const activeAssistantIdRef = useRef<string | null>(null);
  const sentInitialRef = useRef(false);
  const app = useApp();

  // telemetry 订阅、useCancelOrExit、initial_prompt 自动注入、exit-on-done
  // 实现细节从现 ReplMode 搬入，行为等价

  return (
    <Box flexDirection="column" paddingX={1}>
      <ConversationView
        items={transcript.items}
        activeAssistantId={activeAssistantIdRef.current}
        showWelcome={transcript.items.length === 0 && ready}
        version={VERSION}
      />
      {permission && <PermissionDialog ... />}
      <TodoPanel ... />
      <Spinner active={waitingForFirstToken} />
      {ready && <PromptInput ... />}
      <StatusBar ... />
      <Footer ... />
    </Box>
  );
}
```

### cli.tsx 参数

```
oh-tui [options] [prompt]

Options:
  --prompt <text>     initial prompt（自动注入第一句，等价于现 OneShotMode 起点）
  --exit-on-done      首轮完成后退出（与 --prompt 配合 = 现 OneShotMode 行为）
  --theme <name>      启动主题：default | dark | minimal （默认 default）
  --provider X        （已有）
  --model Y           （已有）
  --profile P         （已有）
  --yolo              （已有）
  --bridge-cmd <cmd>  （已有）
  --full-tool-output  （已有）
```

`oh-tui --prompt "hi" --exit-on-done` ≡ 现 `oh-tui --print "hi"` 的等价；保留 `--print` 作为别名直至 14b。

## 节 2 — TranscriptItem 模型

### 新模型

```typescript
export type TranscriptRole =
  | "system"        // /sessions /tools / 错误 / 系统通知
  | "user"          // 用户输入
  | "assistant"     // 助手文本
  | "tool"          // 工具调用 start
  | "tool_result";  // 工具结果 complete

export type SystemSubkind = "sessions" | "tools" | "error" | "info";

export interface TranscriptItem {
  id: string;
  role: TranscriptRole;

  // 文本载荷（所有 role 都有；assistant 流式累加，user/system 一次写入，
  //               tool 不用（args 在 toolInput），tool_result 是结果摘要文本）
  text: string;

  // role === "assistant"
  done?: boolean;

  // role === "tool" | "tool_result"
  toolName?: string;
  toolInput?: unknown;        // role: "tool" 时携带 args
  invocationId?: string;      // 配对键（与 oh-mini bridge 的 invocation_id 同源）
  isError?: boolean;          // role: "tool_result" 时

  // role === "system"
  subkind?: SystemSubkind;
  payload?: unknown;          // SessionListEntry[] / ToolSpec[] / 错误字符串
}
```

### useTranscript 新 API

```typescript
export interface TranscriptApi {
  items: TranscriptItem[];
  itemsRef: React.RefObject<TranscriptItem[]>;
  appendUser: (text: string) => string;
  appendAssistant: () => string;                                    // 返 assistantId
  appendToken: (assistantId: string, chunk: string) => void;
  finishAssistant: (assistantId: string) => void;
  appendTool: (invocationId: string, toolName: string, toolInput: unknown) => string;
  appendToolResult: (invocationId: string, text: string, isError: boolean) => string;
  appendSystem: (subkind: SystemSubkind, payload: unknown) => string;
}
```

### App.tsx 事件路由（vs 现 ReplMode）

```diff
- handle.onEvent(ev → {
-   text_delta → transcript.appendToken(assistantId, chunk)
-   tool_call_started → transcript.appendToolCall(assistantId, call)
-   tool_call_completed → transcript.updateToolCall(assistantId, invId, patch)
- })

+ handle.onEvent(ev → {
+   text_delta → transcript.appendToken(assistantId, chunk)
+   tool_call_started → transcript.appendTool(invId, name, args)
+   tool_call_completed → transcript.appendToolResult(invId, result/error, isError)
+ })
```

`finishAssistant` 仍在 `handle.done` 完成后调用。

### ConversationView 分组渲染

```typescript
function groupAdjacentToolPairs(items: TranscriptItem[]): GroupedItem[] {
  const out: GroupedItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const cur = items[i]!;
    const next = items[i + 1];
    if (
      cur.role === "tool" &&
      next?.role === "tool_result" &&
      cur.invocationId !== undefined &&
      cur.invocationId === next.invocationId
    ) {
      out.push([cur, next] as const);
      i++;
    } else {
      out.push(cur);
    }
  }
  return out;
}
```

配对要求**相邻 + 显式 invocationId 匹配**（比 OpenHarness 纯相邻假设更稳）。

### Static 切分

`<Static>` 渲染**已完成项**（不会再变），动态层渲染**当前活跃 assistant 及其之后的所有项**：

```typescript
const cutIdx = activeAssistantId === null
  ? items.length
  : items.findIndex(it => it.role === "assistant" && it.id === activeAssistantId);
const completed = cutIdx === -1 ? items : items.slice(0, cutIdx);
const active = cutIdx === -1 ? [] : items.slice(cutIdx);
```

Pair group 的 key：`${tool.id}+${result.id}`；单项 key：`item.id`。

### replay.ts 适配

`/resume` 重放从 Anthropic ContentBlock 历史展开时，把 tool_use 和 tool_result 都作为顶层 TranscriptItem 推入，**不再归属到某个 assistant 项下**。配对仍然天然成立（顺序 + invocationId）。

## 节 3 — 主题系统 + 视觉组件

### 3.1 ThemeContext + builtinThemes

```typescript
export interface ThemeConfig {
  name: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    foreground: string;
    muted: string;
    success: string;
    warning: string;
    error: string;
    info: string;
  };
  icons: {
    spinner: string[];
    tool: string;       // e.g. "⏵ "
    assistant: string;  // e.g. "⏺ "
    user: string;       // e.g. "> "
    system: string;     // e.g. "ℹ "
    success: string;    // e.g. "✓ "
    error: string;      // e.g. "✗ "
  };
}

export const defaultTheme: ThemeConfig = { /* cyan/gray, braille spinner */ };
export const darkTheme: ThemeConfig    = { /* tokyonight hex 色板 */ };
export const minimalTheme: ThemeConfig = { /* 单色 white/gray */ };

export const BUILTIN_THEMES: Record<string, ThemeConfig> = {
  default: defaultTheme,
  dark: darkTheme,
  minimal: minimalTheme,
};
```

```typescript
export function ThemeProvider({
  initialTheme = "default",
  children,
}: { initialTheme?: string; children: React.ReactNode }) {
  const [themeName, setThemeName] = useState(
    BUILTIN_THEMES[initialTheme] ? initialTheme : "default",
  );
  const theme = BUILTIN_THEMES[themeName] ?? defaultTheme;
  return (
    <ThemeCtx.Provider value={{ theme, themeName, setThemeName }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme(): ThemeCtxValue {
  return useContext(ThemeCtx);
}
```

**14a 限制**：主题只通过 `--theme <name>` CLI flag 设置，**启动后不能切**。`/theme` 命令在 14b 落地。

### 3.2 WelcomeBanner

```
   ____  __  __         ______ __  __ ____
  / __ \/ /_/ /_       /_  __//  |/  // _/
 / /_/ / __  / -_)____  / /  / /|_/ // /
 \____/_/ /_/\__//____/ /_/  /_/  /_/___/

 An oh-mini-powered terminal coding agent  v<VERSION>

 /help commands  |  /theme switch  |  Ctrl+C exit
```

`VERSION` 从 `package.json` 静态导入（构建期 inline）。LOGO 颜色用 `theme.colors.primary`，命令 hint 也用 primary 高亮。

### 3.3 StatusBar 重做

OpenHarness 风格 — 上方一条 `─` 分隔线，中间 `│` 分隔，按段动态出现：

```
──────────────────────────────────────────────────────────────
model: deepseek-chat │ tokens: 1.2k↓ 3.4k↑ │ mode: yolo │ sess a1b2c3d4
```

```typescript
export interface StatusBarProps {
  provider: string | null;
  model: string | null;
  sessionIdShort: string | null;
  yolo: boolean;
  tokens: { input: number; output: number } | null;
  cancelHint: string | null;
}
```

各段只在数据存在时出现（tokens null 或全 0 → 整段隐藏；yolo 为 false → mode 段隐藏；sessionIdShort null → sess 段隐藏）。

`tokens` 数据源：oh-mini bridge 的 telemetry payload；现 ReplMode 已经订阅了 telemetry，14a 把 token 字段读出来即可。

### 3.4 Footer

```
model=deepseek-chat provider=deepseek auth=ok yolo=false session=a1b2c3d4
```

```typescript
export interface FooterProps {
  provider: string | null;
  model: string | null;
  sessionIdShort: string | null;
  yolo: boolean;
  authStatus: string;  // 简化：14a 固定 "ok"，因为 ready 时认证一定通过
}
```

StatusBar 与 Footer 字段重叠但视觉位置不同（StatusBar 在 ConversationView 下方、PromptInput 上方；Footer 在最底），这是 1:1 OpenHarness 的关键视觉特征 —— 保留两者。

### 3.5 ToolCallDisplay

接收已配对的 `tool + tool_result` 两个 item，统一渲染：

```typescript
export interface ToolCallDisplayProps {
  tool: TranscriptItem;        // role: "tool"
  result?: TranscriptItem;     // role: "tool_result"，undefined 表示仍 running
}

export function ToolCallDisplay({ tool, result }: ToolCallDisplayProps): React.JSX.Element {
  const { theme } = useTheme();
  const status = result === undefined ? "running"
                : result.isError ? "error" : "done";
  const icon = status === "running" ? "▸"
             : status === "done"    ? theme.icons.success.trim()
             :                        theme.icons.error.trim();
  const color = status === "running" ? theme.colors.warning
              : status === "done"    ? theme.colors.success
              :                        theme.colors.error;
  // ... render
}
```

5 行结果裁剪 + `--full-tool-output` flag 已在 v0.3.2 实现，14a 保留现行为（200 字符）。

### 3.6 ConversationView

```typescript
export interface ConversationViewProps {
  items: TranscriptItem[];
  activeAssistantId: string | null;
  showWelcome: boolean;
  version: string;
}
```

逻辑：
1. 若 `showWelcome && items.length === 0`，渲染 `<WelcomeBanner />`
2. 按 `activeAssistantId` 切分 `completed` / `active`
3. `completed` 走 `<Static>`，`active` 动态渲染
4. 每一侧都先做 `groupAdjacentToolPairs`
5. 每个 group 渲染：单项按 role 分发到 MarkdownText / SystemBlock / ToolCallDisplay；pair 渲染为带 result 的 ToolCallDisplay

### 视觉总览（render 顺序，自上而下）

```
┌─────────────────────────────────────────────────────────────┐
│ <ConversationView>                                          │
│   <WelcomeBanner /> （only when items.length === 0）        │
│   <Static>{ completed groups }</Static>                     │
│   { active groups (streaming assistant + running tools) }   │
│                                                             │
│ <PermissionDialog /> （仅当有未决权限）                     │
│ <TodoPanel /> （仅当有 todo_write 调用）                    │
│ <Spinner /> （等首 token 时显示）                           │
│ <PromptInput /> （非 modal 时显示）                         │
│ <StatusBar />                                               │
│ <Footer />                                                  │
└─────────────────────────────────────────────────────────────┘
```

## 节 4 — 测试与发布

### 测试范围

| 测试 | 状态 |
|---|---|
| `tests/lib/markdown.test.ts` | 已有，保留 |
| `tests/components/Spinner.test.tsx` | 已有 + 加一项：spinner frames 从 theme 取 |
| `tests/components/MarkdownText.test.tsx` | 已有，保留 |
| `tests/components/PromptInput.test.tsx` | 已有，保留 |
| `tests/hooks/useTranscript.test.ts` | 新建：全部 API 各跑一遍，断言 items 顺序与字段 |
| `tests/components/ConversationView.test.tsx` | 新建 3 用例：(a) 空+welcome 渲染 LOGO；(b) tool+tool_result 配对成单个 ToolCallDisplay；(c) 孤立 running tool（无 result）单独显示 |
| `tests/components/StatusBar.test.tsx` | 新建：tokens 缺失整段隐藏、yolo 时显示 mode、cancelHint 显示 warning 色 |
| `tests/theme/ThemeContext.test.tsx` | 新建：未知主题名退回 default、setThemeName 真切换 |

### 手工 smoke 清单（commit message 引用）

`pnpm start` 后逐条验证：

1. WelcomeBanner LOGO 在空会话首屏出现
2. 输入 hello → spinner → MarkdownText 流式渲染 → Welcome 消失，转入 transcript
3. 触发一个 tool（让 LLM 用 Bash/Read）→ 顶层显示 `▸ tool_name` running → 完成后变 `✓` + 结果摘要
4. `/sessions` → system 项展开 session 列表
5. StatusBar 显示 `model: X │ sess Y`；带 telemetry 时显示 tokens 段；`--yolo` 启动时显示 mode 段
6. Footer 一行可读
7. Ctrl+C 在 idle / running 两种状态行为正确（14a 维持现 useCancelOrExit 双击逻辑）
8. `--theme dark` → 整体配色变蓝紫；`--theme minimal` → 单色调
9. `--prompt "hi" --exit-on-done` → 自动提交 + 完成后退出
10. `--prompt "hi"`（无 --exit-on-done）→ 自动提交 + 留在 REPL

### Release

- `package.json`: `0.3.3` → **`0.4.0`**（破坏性重构 + 新视觉，bump minor）
- `README.md` 新加一节 **"What's new in v0.4.0 — OpenHarness 1:1 visual refresh (Phase 14a)"**
- `git tag v0.4.0`

### 风险

| 风险 | 缓解 |
|---|---|
| `<Static>` + 顶层 tool 项稳定 key | 每项独立 id；pair group key 用 `${tool.id}+${result.id}` |
| 大重构破坏 `--prompt` 单轮行为 | `--prompt` + `--exit-on-done` flag + 手工 smoke #9/#10 专门验证 |
| ReplMode 654 行业务逻辑迁入 App.tsx 时漏 | 分两个 commit：先**搬迁等价**（行为不变），后**重构对接新组件**；每个 commit 跑 typecheck + test |
| 主题 hex 色在不支持真彩色终端降级 | Ink 自动回退到最近的 ANSI 色；接受 |
| TranscriptItem 模型变更影响 `/resume` replay | `replay.ts` 同步更新；测试覆盖（在 `useTranscript.test.ts` 中包含 replay 路径） |

## 范围外（明确写进 spec，避免误以为漏做）

- CommandPicker / slash 补全 → **14b**
- Tab 补全 / 数字键快选 → **14b**
- Esc 双击清输入 → **14b**
- Ctrl+C 行为对齐 OpenHarness 单击 → **14b**
- `/theme` 命令 → **14b**
- assistant delta 50ms/384 chars buffering → **14c**
- `useDeferredValue` 优化 → **14c**
- SidePanel → **14c**
- TodoPanel markdown 数据源 → **14c**
- 5 行 tool 结果裁剪 + `--full-tool-output` → 已在 v0.3.2 完成，**不动**
- 永久砍：SwarmPanel、permission_mode、vim、voice、effort/passes/turns、Mcp/Bridge 计数、shift+enter 多行
