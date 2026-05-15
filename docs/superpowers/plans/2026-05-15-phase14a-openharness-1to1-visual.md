# Phase 14a Implementation Plan — OpenHarness 1:1 visual refresh

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship oh-tui v0.4.0 — modes/ReplMode + OneShotMode 二分消解为单一 App；引入主题系统；TranscriptItem 升顶层 tool/tool_result role；WelcomeBanner / ConversationView / ToolCallDisplay / Footer 新增；StatusBar 重做。

**Architecture:** 单一 `App.tsx`（`ThemeProvider` + `AppInner`）吸收原 ReplMode 全部逻辑 + OneShotMode 的 `--prompt`/`--exit-on-done` 行为。TranscriptItem 由"tagged kind"变为"role 平铺"：tool 与 tool_result 升为顶层项，ConversationView 用相邻 + invocationId 配对渲染。主题系统通过 React Context 注入颜色与图标，所有视觉组件读 `useTheme()`。

**Tech Stack:** TypeScript 5 strict, Ink 5, React 18, vitest + ink-testing-library，@meta-harney/bridge-client（git workspace dep）。

**Spec:** `docs/superpowers/specs/2026-05-15-phase14a-openharness-1to1-visual-design.md`

**Repo:** `/Users/baihe/Projects/study/oh-tui`（branch `master`）

---

## File map

| File | Action | Task |
|---|---|---|
| `src/types.ts` | Modify (重定义 TranscriptItem) | T1 |
| `src/hooks/useTranscript.ts` | Rewrite | T1 |
| `tests/hooks/useTranscript.test.ts` | Create | T1 |
| `src/theme/builtinThemes.ts` | Create | T2 |
| `src/theme/ThemeContext.tsx` | Create | T2 |
| `tests/theme/ThemeContext.test.tsx` | Create | T2 |
| `src/components/Spinner.tsx` | Modify (useTheme) | T3 |
| `tests/components/Spinner.test.tsx` | Modify (+ theme 断言) | T3 |
| `src/components/TodoPanel.tsx` | Modify (useTheme) | T3 |
| `src/components/MarkdownText.tsx` | Modify (useTheme) | T3 |
| `src/components/WelcomeBanner.tsx` | Create | T4 |
| `src/components/ToolCallDisplay.tsx` | Create | T5 |
| `src/components/ConversationView.tsx` | Create | T6 |
| `tests/components/ConversationView.test.tsx` | Create | T6 |
| `src/components/StatusBar.tsx` | Rewrite | T7 |
| `tests/components/StatusBar.test.tsx` | Create | T7 |
| `src/components/Footer.tsx` | Create | T8 |
| `src/lib/replay.ts` | Rewrite (顶层 tool/tool_result) | T9 |
| `tests/lib/replay.test.ts` | Update | T9 |
| `src/App.tsx` | Rewrite (吸收 ReplMode + OneShotMode) | T10 |
| `src/cli.tsx` | Modify (--prompt / --exit-on-done / --theme) | T10 |
| `src/modes/ReplMode.tsx` | Delete | T10 |
| `src/modes/OneShotMode.tsx` | Delete | T10 |
| `src/components/TranscriptItemView.tsx` | Delete | T10 |
| `src/components/ToolCallView.tsx` | Delete | T10 |
| `src/components/StreamingMessage.tsx` | Delete | T10 |
| `package.json` | Modify (v0.4.0) | T11 |
| `README.md` | Modify (v0.4.0 changelog) | T11 |

---

### Task 1: TranscriptItem 新模型 + useTranscript 重写 + 测试

**Files:**
- Modify: `src/types.ts`
- Rewrite: `src/hooks/useTranscript.ts`
- Create: `tests/hooks/useTranscript.test.ts`

- [ ] **Step 1: 重写 `src/types.ts`**

替换原文件全部内容：

```typescript
/**
 * Shared types for oh-tui.
 */

export type { SessionListEntry, ToolSpec } from "@meta-harney/bridge-client";

export interface CliArgs {
  prompt: string | null;
  exitOnDone: boolean;
  theme: string;
  provider: string | null;
  profile: string | null;
  model: string | null;
  framing: "newline" | "content-length";
  bridgeBin: string;
  bridgeArgs: string[];
  yolo: boolean;
  /**
   * When true, tool results render in full; otherwise ToolCallDisplay truncates
   * them. Default false keeps the REPL readable on tools that dump kilobytes.
   */
  fullToolOutput: boolean;
}

export type TranscriptRole =
  | "system"
  | "user"
  | "assistant"
  | "tool"
  | "tool_result";

export type SystemSubkind = "sessions" | "tools" | "error" | "info";

/**
 * Flat transcript item. `tool` and `tool_result` are top-level rows that
 * carry an `invocationId` for adjacent-pair grouping in ConversationView.
 */
export interface TranscriptItem {
  id: string;
  role: TranscriptRole;
  text: string;

  // role === "assistant"
  done?: boolean;

  // role === "tool" | "tool_result"
  toolName?: string;
  toolInput?: unknown;
  invocationId?: string;
  isError?: boolean;

  // role === "system"
  subkind?: SystemSubkind;
  payload?: unknown;
}
```

- [ ] **Step 2: Rewrite `src/hooks/useTranscript.ts`**

替换原文件全部内容：

```typescript
/**
 * useTranscript — owns the chronological scrollback.
 *
 * Items are flat rows with a `role` field. Tool calls and tool results are
 * top-level rows linked by `invocationId`; ConversationView pairs them in
 * the renderer rather than nesting them on an assistant item.
 *
 * Each item has a stable string `id` so React + Ink's <Static> can dedupe
 * completed entries.
 */

import { useCallback, useRef, useState } from "react";
import type {
  SystemSubkind,
  TranscriptItem,
} from "../types.js";

let _idCounter = 0;
function nextId(): string {
  _idCounter += 1;
  return `t${_idCounter}`;
}

export function useTranscript() {
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const itemsRef = useRef<TranscriptItem[]>(items);
  itemsRef.current = items;

  const appendUser = useCallback((text: string): string => {
    const id = nextId();
    setItems((prev) => [
      ...prev,
      { id, role: "user", text },
    ]);
    return id;
  }, []);

  const appendAssistant = useCallback((): string => {
    const id = nextId();
    setItems((prev) => [
      ...prev,
      { id, role: "assistant", text: "", done: false },
    ]);
    return id;
  }, []);

  const appendToken = useCallback((assistantId: string, chunk: string): void => {
    if (chunk.length === 0) return;
    setItems((prev) =>
      prev.map((item) =>
        item.role === "assistant" && item.id === assistantId
          ? { ...item, text: item.text + chunk }
          : item,
      ),
    );
  }, []);

  const finishAssistant = useCallback((assistantId: string): void => {
    setItems((prev) =>
      prev.map((item) =>
        item.role === "assistant" && item.id === assistantId
          ? { ...item, done: true }
          : item,
      ),
    );
  }, []);

  const appendTool = useCallback(
    (invocationId: string, toolName: string, toolInput: unknown): string => {
      const id = nextId();
      setItems((prev) => [
        ...prev,
        {
          id,
          role: "tool",
          text: "",
          toolName,
          toolInput,
          invocationId,
        },
      ]);
      return id;
    },
    [],
  );

  const appendToolResult = useCallback(
    (invocationId: string, text: string, isError: boolean): string => {
      const id = nextId();
      setItems((prev) => [
        ...prev,
        {
          id,
          role: "tool_result",
          text,
          invocationId,
          isError,
        },
      ]);
      return id;
    },
    [],
  );

  const appendSystem = useCallback(
    (subkind: SystemSubkind, payload: unknown): string => {
      const id = nextId();
      const text = typeof payload === "string" ? payload : "";
      setItems((prev) => [
        ...prev,
        { id, role: "system", text, subkind, payload },
      ]);
      return id;
    },
    [],
  );

  /**
   * Replace the entire transcript. Used by /resume.
   */
  const replayMessages = useCallback((next: TranscriptItem[]): void => {
    setItems(next);
  }, []);

  const clear = useCallback((): void => {
    setItems([]);
  }, []);

  return {
    items,
    itemsRef,
    appendUser,
    appendAssistant,
    appendToken,
    finishAssistant,
    appendTool,
    appendToolResult,
    appendSystem,
    replayMessages,
    clear,
  };
}

export type TranscriptApi = ReturnType<typeof useTranscript>;
```

- [ ] **Step 3: 写测试 `tests/hooks/useTranscript.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTranscript } from "../../src/hooks/useTranscript.js";

describe("useTranscript", () => {
  it("appendUser appends a user role item with the given text", () => {
    const { result } = renderHook(() => useTranscript());
    let id = "";
    act(() => {
      id = result.current.appendUser("hello");
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({
      id,
      role: "user",
      text: "hello",
    });
  });

  it("appendAssistant + appendToken streams text into the same item", () => {
    const { result } = renderHook(() => useTranscript());
    let aid = "";
    act(() => {
      aid = result.current.appendAssistant();
    });
    act(() => {
      result.current.appendToken(aid, "Hel");
      result.current.appendToken(aid, "lo");
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({
      id: aid,
      role: "assistant",
      text: "Hello",
      done: false,
    });
  });

  it("finishAssistant flips done to true", () => {
    const { result } = renderHook(() => useTranscript());
    let aid = "";
    act(() => {
      aid = result.current.appendAssistant();
    });
    act(() => {
      result.current.finishAssistant(aid);
    });
    expect(result.current.items[0]).toMatchObject({ id: aid, done: true });
  });

  it("appendTool + appendToolResult are top-level rows linked by invocationId", () => {
    const { result } = renderHook(() => useTranscript());
    act(() => {
      result.current.appendAssistant();
      result.current.appendTool("inv-1", "Bash", { cmd: "ls" });
      result.current.appendToolResult("inv-1", "file.txt\nfile2.txt", false);
    });
    expect(result.current.items).toHaveLength(3);
    expect(result.current.items[1]).toMatchObject({
      role: "tool",
      toolName: "Bash",
      invocationId: "inv-1",
    });
    expect(result.current.items[2]).toMatchObject({
      role: "tool_result",
      text: "file.txt\nfile2.txt",
      invocationId: "inv-1",
      isError: false,
    });
  });

  it("appendSystem stores subkind + payload", () => {
    const { result } = renderHook(() => useTranscript());
    act(() => {
      result.current.appendSystem("info", "hello");
    });
    expect(result.current.items[0]).toMatchObject({
      role: "system",
      subkind: "info",
      payload: "hello",
      text: "hello",
    });
  });

  it("replayMessages replaces the entire transcript", () => {
    const { result } = renderHook(() => useTranscript());
    act(() => {
      result.current.appendUser("first");
    });
    act(() => {
      result.current.replayMessages([
        { id: "x1", role: "user", text: "replay-user" },
        { id: "x2", role: "assistant", text: "replay-assistant", done: true },
      ]);
    });
    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0]?.text).toBe("replay-user");
  });

  it("clear empties the transcript", () => {
    const { result } = renderHook(() => useTranscript());
    act(() => {
      result.current.appendUser("x");
      result.current.appendUser("y");
    });
    act(() => {
      result.current.clear();
    });
    expect(result.current.items).toHaveLength(0);
  });
});
```

- [ ] **Step 4: 确认依赖已安装**

`@testing-library/react` 是否已经在 devDeps？打开 `package.json` 查 `devDependencies`。如果**没有**，先添加：

```bash
pnpm add -D @testing-library/react@^14.0.0 @testing-library/react-hooks
```

如果已有，跳过。

- [ ] **Step 5: 运行测试**

```bash
pnpm test useTranscript
```

预期：7 个测试全 pass。如果有 fail，根据错误信息定位修复（最常见：useTranscript 闭包没拿到最新 setItems —— 我们用 setItems(prev => ...) 应该没问题；其次是 setItems 同步性 —— `renderHook` + `act` 已经保证）。

- [ ] **Step 6: typecheck**

```bash
pnpm typecheck
```

预期：**会有错误**——`useTranscript` 的旧 API（`appendToolCall` / `updateToolCall`）被 ReplMode / OneShotMode / replay.ts / TranscriptItemView 引用，这些文件在 T9/T10 才删除。**这一步预期的错误**：

- `src/lib/replay.ts`、`src/modes/ReplMode.tsx`、`src/modes/OneShotMode.tsx`、`src/components/TranscriptItemView.tsx` 内多处 typecheck 错误

**不要在这一步修复它们**——T9 / T10 会重写或删除。本 task 只追加 useTranscript 的新 API；旧 API 暂时由 ReplMode/OneShotMode 通过 ts-expect-error 续命？**不**。更简单的处理：

**保留旧 API 直到 T10**——在 useTranscript 末尾同时导出旧 `appendToolCall` / `updateToolCall` 作为兼容垫片（no-op），让 typecheck 当下通过：

在 `useTranscript.ts` 末尾的 `return {...}` 块之前，加 4 个 stubbed callbacks：

```typescript
  // Legacy shims kept until ReplMode/OneShotMode/TranscriptItemView are
  // deleted in T10. These are no-ops on the new flat model.
  const appendToolCall = useCallback(
    (_assistantId: string, _call: unknown): void => {},
    [],
  );
  const updateToolCall = useCallback(
    (_assistantId: string, _invocationId: string, _patch: unknown): void => {},
    [],
  );
```

并在 return 中加 `appendToolCall, updateToolCall,`。

T10 删 ReplMode/OneShotMode 后，连同 shims 一起删除。

重新跑：

```bash
pnpm typecheck
```

如果 TranscriptItemView 还报 `kind` 找不到——TranscriptItemView 也会读 `item.kind`。**也保留**：types.ts 在新模型基础上**额外**导出旧名作为类型别名以维持过渡期编译：

实际上更干净的做法是：types.ts 里同时保留旧的 tagged-union 和新 flat 模型，由文件分别按需要使用。**不要这样做**——这会让 T1 异常复杂。

**正确做法**：T1 只改 types.ts 的 `TranscriptItem`，会让 4 个旧文件（replay.ts / ReplMode / OneShotMode / TranscriptItemView）的 typecheck 失败。**接受这个失败**，T10 删除这些文件后 typecheck 自然恢复。在 T1 commit message 里写明：

> typecheck 暂时失败，预期在 T10 删除旧 modes/ + 旧 TranscriptItemView 后恢复。中间 T2-T9 不会引入新的 typecheck 引用——它们只新增独立模块。

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/hooks/useTranscript.ts tests/hooks/useTranscript.test.ts
git commit -m "feat(types): TranscriptItem flat role model + useTranscript rewrite

- TranscriptItem 由 tagged kind 变为 role 平铺；tool / tool_result 升顶层
  项，由 invocationId 配对（ConversationView 在 T6 实装）
- useTranscript 新增 appendTool / appendToolResult；保留 replayMessages /
  clear 兼容 /resume
- types.ts 新增 CliArgs.prompt / exitOnDone / theme（T10 解析）

typecheck 在 T1 后会有 4 个旧文件失败（replay.ts / ReplMode / OneShotMode /
TranscriptItemView），预期在 T10 删除后恢复。"
```

---

### Task 2: ThemeContext + builtinThemes + 测试

**Files:**
- Create: `src/theme/builtinThemes.ts`
- Create: `src/theme/ThemeContext.tsx`
- Create: `tests/theme/ThemeContext.test.tsx`

- [ ] **Step 1: 创建 `src/theme/builtinThemes.ts`**

```typescript
/**
 * Built-in themes — color palette + icon glyphs that visual components consume
 * via useTheme(). New themes can be added here; CLI/--theme falls back to
 * "default" when an unknown name is given.
 */

export interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;
  foreground: string;
  muted: string;
  success: string;
  warning: string;
  error: string;
  info: string;
}

export interface ThemeIcons {
  spinner: string[];
  tool: string;
  assistant: string;
  user: string;
  system: string;
  success: string;
  error: string;
}

export interface ThemeConfig {
  name: string;
  colors: ThemeColors;
  icons: ThemeIcons;
}

const BRAILLE_SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export const defaultTheme: ThemeConfig = {
  name: "default",
  colors: {
    primary: "cyan",
    secondary: "white",
    accent: "cyan",
    foreground: "white",
    muted: "gray",
    success: "green",
    warning: "yellow",
    error: "red",
    info: "blue",
  },
  icons: {
    spinner: BRAILLE_SPINNER,
    tool: "⏵ ",
    assistant: "⏺ ",
    user: "> ",
    system: "ℹ ",
    success: "✓ ",
    error: "✗ ",
  },
};

export const darkTheme: ThemeConfig = {
  name: "dark",
  colors: {
    primary: "#7aa2f7",
    secondary: "#c0caf5",
    accent: "#bb9af7",
    foreground: "#c0caf5",
    muted: "#565f89",
    success: "#9ece6a",
    warning: "#e0af68",
    error: "#f7768e",
    info: "#7dcfff",
  },
  icons: {
    spinner: BRAILLE_SPINNER,
    tool: "⏵ ",
    assistant: "⏺ ",
    user: "> ",
    system: "ℹ ",
    success: "✓ ",
    error: "✗ ",
  },
};

export const minimalTheme: ThemeConfig = {
  name: "minimal",
  colors: {
    primary: "white",
    secondary: "white",
    accent: "white",
    foreground: "white",
    muted: "gray",
    success: "white",
    warning: "white",
    error: "white",
    info: "white",
  },
  icons: {
    spinner: ["-", "\\", "|", "/"],
    tool: "* ",
    assistant: "> ",
    user: "$ ",
    system: "- ",
    success: "+ ",
    error: "! ",
  },
};

export const BUILTIN_THEMES: Record<string, ThemeConfig> = {
  default: defaultTheme,
  dark: darkTheme,
  minimal: minimalTheme,
};

export function resolveTheme(name: string | undefined): ThemeConfig {
  if (name !== undefined && BUILTIN_THEMES[name] !== undefined) {
    return BUILTIN_THEMES[name]!;
  }
  return defaultTheme;
}
```

- [ ] **Step 2: 创建 `src/theme/ThemeContext.tsx`**

```typescript
/**
 * Theme provider + useTheme() hook.
 *
 * Phase 14a: theme is fixed at startup via --theme CLI flag. Phase 14b adds
 * /theme command to switch at runtime, using setThemeName.
 */

import type React from "react";
import { createContext, useContext, useMemo, useState } from "react";
import {
  BUILTIN_THEMES,
  defaultTheme,
  resolveTheme,
  type ThemeConfig,
} from "./builtinThemes.js";

interface ThemeCtxValue {
  theme: ThemeConfig;
  themeName: string;
  setThemeName: (name: string) => void;
}

const ThemeCtx = createContext<ThemeCtxValue>({
  theme: defaultTheme,
  themeName: "default",
  setThemeName: () => {},
});

export interface ThemeProviderProps {
  initialTheme?: string;
  children: React.ReactNode;
}

export function ThemeProvider({
  initialTheme = "default",
  children,
}: ThemeProviderProps): React.JSX.Element {
  const [themeName, setThemeNameState] = useState(() =>
    BUILTIN_THEMES[initialTheme] !== undefined ? initialTheme : "default",
  );

  const value = useMemo<ThemeCtxValue>(
    () => ({
      theme: resolveTheme(themeName),
      themeName,
      setThemeName: (name: string): void => {
        if (BUILTIN_THEMES[name] !== undefined) {
          setThemeNameState(name);
        }
      },
    }),
    [themeName],
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeCtxValue {
  return useContext(ThemeCtx);
}
```

- [ ] **Step 3: 写测试 `tests/theme/ThemeContext.test.tsx`**

```typescript
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";
import {
  ThemeProvider,
  useTheme,
} from "../../src/theme/ThemeContext.js";

function Probe({ onTheme }: { onTheme: (name: string) => void }): React.JSX.Element {
  const { themeName } = useTheme();
  onTheme(themeName);
  return <Text>{themeName}</Text>;
}

describe("ThemeContext", () => {
  it("uses initialTheme when known", () => {
    let observed = "";
    render(
      <ThemeProvider initialTheme="dark">
        <Probe onTheme={(n) => (observed = n)} />
      </ThemeProvider>,
    );
    expect(observed).toBe("dark");
  });

  it("falls back to default when initialTheme is unknown", () => {
    let observed = "";
    render(
      <ThemeProvider initialTheme="not-a-real-theme">
        <Probe onTheme={(n) => (observed = n)} />
      </ThemeProvider>,
    );
    expect(observed).toBe("default");
  });

  it("default theme exposes braille spinner frames", () => {
    let frames: string[] = [];
    function Inspect(): React.JSX.Element {
      const { theme } = useTheme();
      frames = theme.icons.spinner;
      return <Text>x</Text>;
    }
    render(
      <ThemeProvider>
        <Inspect />
      </ThemeProvider>,
    );
    expect(frames).toContain("⠋");
    expect(frames.length).toBeGreaterThan(5);
  });
});
```

需要在文件顶部加 `import type React from "react";`。

- [ ] **Step 4: 运行测试**

```bash
pnpm test ThemeContext
```

预期：3 个测试 pass。

- [ ] **Step 5: typecheck**

```bash
pnpm typecheck
```

预期：T1 已知的旧文件错误**不变**（不会因 T2 增多）。新模块独立。

- [ ] **Step 6: Commit**

```bash
git add src/theme/builtinThemes.ts src/theme/ThemeContext.tsx tests/theme/ThemeContext.test.tsx
git commit -m "feat(theme): ThemeContext + 3 builtin themes (default/dark/minimal)

default = 当前 hardcoded 色板；dark = tokyonight 色板；minimal = 单色 ASCII。
未知主题名 fallback default。setThemeName 留作 T10/14b /theme 命令使用。"
```

---

### Task 3: 已有 3 个组件接入 useTheme

**Files:**
- Modify: `src/components/Spinner.tsx`
- Modify: `tests/components/Spinner.test.tsx`
- Modify: `src/components/TodoPanel.tsx`
- Modify: `src/components/MarkdownText.tsx`

- [ ] **Step 1: Rewrite `src/components/Spinner.tsx`**

```typescript
import type React from "react";
import { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/ThemeContext.js";

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
  const { theme } = useTheme();
  const frames = theme.icons.spinner;
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const handle = setInterval(
      () => setI((x) => (x + 1) % frames.length),
      intervalMs,
    );
    return () => clearInterval(handle);
  }, [active, intervalMs, frames.length]);
  if (!active) return null;
  return (
    <Box>
      <Text color={theme.colors.primary}>{frames[i]}</Text>
      <Text dimColor> {label}…</Text>
    </Box>
  );
}
```

- [ ] **Step 2: Modify `tests/components/Spinner.test.tsx`**

Spinner 现在依赖 ThemeProvider。每个 render 用例包装在 ThemeProvider 内。**先读现有测试**确认改动幅度。如果现有用例直接 `render(<Spinner ... />)`，把它们改成 `render(<ThemeProvider><Spinner ... /></ThemeProvider>)`。同时新增一个测试：

```typescript
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { Spinner } from "../../src/components/Spinner.js";
import { ThemeProvider } from "../../src/theme/ThemeContext.js";

describe("Spinner (with theme)", () => {
  it("renders label and a braille frame when active under default theme", () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <Spinner active={true} label="thinking" />
      </ThemeProvider>,
    );
    expect(lastFrame()).toContain("thinking");
    // 默认主题首帧是 "⠋"
    expect(lastFrame()).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u);
  });

  it("renders ASCII frames under minimal theme", () => {
    const { lastFrame } = render(
      <ThemeProvider initialTheme="minimal">
        <Spinner active={true} label="x" />
      </ThemeProvider>,
    );
    expect(lastFrame()).toMatch(/[-\\|/]/);
  });

  it("renders nothing when inactive", () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <Spinner active={false} label="x" />
      </ThemeProvider>,
    );
    expect((lastFrame() ?? "").trim()).toBe("");
  });
});
```

**保留**当前文件已有的其他测试用例（若有）；把它们也包到 ThemeProvider 里。

- [ ] **Step 3: Modify `src/components/TodoPanel.tsx`**

整个文件保留，**仅修改** `TodoPanel` 函数中边框颜色：

```typescript
import { useTheme } from "../theme/ThemeContext.js";

// ... 文件顶部其他保留

export function TodoPanel({ todos }: TodoPanelProps): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.colors.primary}
      paddingX={1}
      marginY={1}
    >
      <Text bold>plan</Text>
      {todos.map((t, i) => (
        <Box key={i}>
          <Text color={COLOR[t.status]}>{ICON[t.status]} </Text>
          <Text
            dimColor={t.status === "completed"}
            strikethrough={t.status === "completed"}
          >
            {t.content}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
```

注意：existing `TodoPanel.test.tsx` 直接 render，需要包 ThemeProvider。读现有 test 文件，把每个 `render(...)` 包 `<ThemeProvider>...</ThemeProvider>`。

- [ ] **Step 4: Modify `src/components/MarkdownText.tsx`**

`BlockRender` 函数里 heading / code_block / list_item / blockquote 用主题色：

替换 `BlockRender` 函数（仅函数体）：

```typescript
function BlockRender({ tok }: { tok: Token }): React.JSX.Element {
  const { theme } = useTheme();
  if (tok.type === "heading") {
    const color =
      tok.level === 1
        ? theme.colors.accent
        : tok.level === 2
          ? theme.colors.primary
          : theme.colors.warning;
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
      <Box
        flexDirection="column"
        marginY={1}
        borderStyle="single"
        paddingX={1}
      >
        {tok.lang !== null && <Text dimColor>{tok.lang}</Text>}
        <Text>{tok.code}</Text>
      </Box>
    );
  }
  if (tok.type === "list_item") {
    return (
      <Box>
        <Text color={theme.colors.primary}>{tok.marker} </Text>
        <InlineRender tokens={tok.text} />
      </Box>
    );
  }
  if (tok.type === "blockquote") {
    return (
      <Box>
        <Text color={theme.colors.primary}>▎ </Text>
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
```

在文件顶部加：

```typescript
import { useTheme } from "../theme/ThemeContext.js";
```

`MarkdownText` 函数本身不需要改（它只调用 BlockRender 列表）。注意 existing `MarkdownText.test.tsx` 是否直接 render——读现有测试，把 render 包 ThemeProvider。

- [ ] **Step 5: 运行所有受影响的测试**

```bash
pnpm test Spinner TodoPanel MarkdownText
```

预期：全 pass。如果有 fail，最大概率是 test 没包 ThemeProvider —— 把那个 render 包起来即可。

- [ ] **Step 6: typecheck**

```bash
pnpm typecheck
```

预期：T1 已知的 4 个旧文件错误**不变**。

- [ ] **Step 7: Commit**

```bash
git add src/components/Spinner.tsx src/components/TodoPanel.tsx src/components/MarkdownText.tsx tests/components/Spinner.test.tsx tests/components/TodoPanel.test.tsx tests/components/MarkdownText.test.tsx
git commit -m "feat(theme): Spinner / TodoPanel / MarkdownText 接入 useTheme

- Spinner 用 theme.icons.spinner + theme.colors.primary
- TodoPanel 边框色用 theme.colors.primary
- MarkdownText heading / list / blockquote 用主题色
- 测试包装在 ThemeProvider 内，新增 minimal 主题 spinner 断言"
```

---

### Task 4: WelcomeBanner 组件

**Files:**
- Create: `src/components/WelcomeBanner.tsx`

- [ ] **Step 1: Create `src/components/WelcomeBanner.tsx`**

```typescript
/**
 * WelcomeBanner — splash logo shown when the transcript is empty.
 *
 * Rendered by ConversationView only when items.length === 0 && ready.
 * Theme provides the LOGO color; version flows through from package.json
 * via the App component (constant inlined at build time / startup).
 */

import type React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/ThemeContext.js";

const LOGO: string[] = [
  "   ____  __     __        __        _ ",
  "  / __ \\/ /_   / /___  __/ /__  ___| |",
  " / / / / __ \\ / __/ / / / / _ \\/ __| |",
  "/ /_/ / / / // /_/ /_/ / /  __/ (__|_|",
  "\\____/_/ /_/(_)__/\\__,_/_/\\___/\\___(_)",
];

export interface WelcomeBannerProps {
  version: string;
}

export function WelcomeBanner({ version }: WelcomeBannerProps): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <Box flexDirection="column" marginBottom={1}>
      {LOGO.map((line, i) => (
        <Text key={i} color={theme.colors.primary} bold>
          {line}
        </Text>
      ))}
      <Text> </Text>
      <Text>
        <Text dimColor> An oh-mini-powered terminal coding agent</Text>
        <Text dimColor>{"  "}v{version}</Text>
      </Text>
      <Text> </Text>
      <Text>
        <Text dimColor> </Text>
        <Text color={theme.colors.primary}>/help</Text>
        <Text dimColor> commands  |  </Text>
        <Text color={theme.colors.primary}>/theme</Text>
        <Text dimColor> switch (14b)  |  </Text>
        <Text color={theme.colors.primary}>Ctrl+C</Text>
        <Text dimColor> exit</Text>
      </Text>
    </Box>
  );
}
```

- [ ] **Step 2: typecheck + lint**

```bash
pnpm typecheck
```

T1 旧错误依旧；不应有 WelcomeBanner 引入的新错误。

- [ ] **Step 3: Commit**

```bash
git add src/components/WelcomeBanner.tsx
git commit -m "feat(tui): WelcomeBanner with oh-tui ASCII LOGO + version + command hints

主题色驱动；ConversationView 在 transcript 空 + ready 时渲染。
/theme 命令尾部标 (14b) 表示尚未实装。"
```

---

### Task 5: ToolCallDisplay 组件

**Files:**
- Create: `src/components/ToolCallDisplay.tsx`

- [ ] **Step 1: Create `src/components/ToolCallDisplay.tsx`**

```typescript
/**
 * ToolCallDisplay — render a tool invocation pair (tool + tool_result) or
 * a standalone running tool. Replaces ToolCallView from Phase 12.
 *
 * Visual:
 *   ▸ Bash {"cmd":"ls"}      ← running, no result
 *   ✓ Bash {"cmd":"ls"}      ← done
 *     file.txt
 *     file2.txt
 *   ✗ Bash {"cmd":"bad"}     ← error
 *     command not found: bad
 */

import type React from "react";
import { Box, Text } from "ink";
import type { TranscriptItem } from "../types.js";
import { useTheme } from "../theme/ThemeContext.js";

export interface ToolCallDisplayProps {
  tool: TranscriptItem;          // role: "tool"
  result?: TranscriptItem;       // role: "tool_result", undefined = still running
  fullToolOutput: boolean;
}

const DEFAULT_TRUNC = 5; // 5 lines

export function ToolCallDisplay({
  tool,
  result,
  fullToolOutput,
}: ToolCallDisplayProps): React.JSX.Element {
  const { theme } = useTheme();
  const status: "running" | "done" | "error" =
    result === undefined
      ? "running"
      : result.isError === true
        ? "error"
        : "done";

  const icon =
    status === "running"
      ? "▸"
      : status === "done"
        ? theme.icons.success.trim()
        : theme.icons.error.trim();
  const color =
    status === "running"
      ? theme.colors.warning
      : status === "done"
        ? theme.colors.success
        : theme.colors.error;

  const argsBlurb = stringifyArgs(tool.toolInput);
  const resultText = result?.text ?? "";

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color}>{icon} </Text>
        <Text bold>{tool.toolName ?? "tool"}</Text>
        {argsBlurb.length > 0 && (
          <Text dimColor>  {argsBlurb}</Text>
        )}
      </Box>
      {status !== "running" && resultText.length > 0 && (
        <Box marginLeft={2}>
          <Text dimColor>{truncateOutput(resultText, fullToolOutput)}</Text>
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
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function truncateOutput(text: string, full: boolean): string {
  if (full) return text;
  const lines = text.split("\n");
  if (lines.length <= DEFAULT_TRUNC) return text;
  return `${lines.slice(0, DEFAULT_TRUNC).join("\n")}\n… ${lines.length - DEFAULT_TRUNC} more lines`;
}
```

- [ ] **Step 2: typecheck**

```bash
pnpm typecheck
```

预期 T1 已知错误不变；ToolCallDisplay 自身无错。

- [ ] **Step 3: Commit**

```bash
git add src/components/ToolCallDisplay.tsx
git commit -m "feat(tui): ToolCallDisplay with tool + tool_result pairing

ToolCallDisplay 配对渲染顶层 tool + tool_result transcript 项；
status 由 result 存在性 + isError 标志决定（running / done / error）。
保留 v0.3.2 引入的 5-line 截断 + --full-tool-output flag。"
```

---

### Task 6: ConversationView 组件 + 测试

**Files:**
- Create: `src/components/ConversationView.tsx`
- Create: `tests/components/ConversationView.test.tsx`

- [ ] **Step 1: Create `src/components/ConversationView.tsx`**

```typescript
/**
 * ConversationView — top-level transcript renderer.
 *
 * Responsibilities:
 *   - Show WelcomeBanner when transcript is empty.
 *   - Split items into `completed` (rendered inside <Static>) and `active`
 *     (rendered dynamically). The cut is at `activeAssistantId`.
 *   - Group adjacent `tool` + `tool_result` pairs (matched by invocationId)
 *     and hand them to <ToolCallDisplay>.
 *   - Render non-tool rows by role: user / assistant via MarkdownText /
 *     system via SystemBlock.
 *
 * Static + group: a paired tool/tool_result becomes a single Static row; we
 * use `${tool.id}+${result.id}` as the group key so it stays stable across
 * renders.
 */

import type React from "react";
import { Box, Static, Text } from "ink";
import type { TranscriptItem, SessionListEntry, ToolSpec } from "../types.js";
import { MarkdownText } from "./MarkdownText.js";
import { ToolCallDisplay } from "./ToolCallDisplay.js";
import { WelcomeBanner } from "./WelcomeBanner.js";

export interface ConversationViewProps {
  items: TranscriptItem[];
  activeAssistantId: string | null;
  showWelcome: boolean;
  version: string;
  fullToolOutput: boolean;
}

type GroupedItem = TranscriptItem | { pair: [TranscriptItem, TranscriptItem]; key: string };

function isPair(g: GroupedItem): g is { pair: [TranscriptItem, TranscriptItem]; key: string } {
  return (g as { pair?: unknown }).pair !== undefined;
}

export function groupAdjacentToolPairs(items: TranscriptItem[]): GroupedItem[] {
  const out: GroupedItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const cur = items[i]!;
    const next = items[i + 1];
    if (
      cur.role === "tool" &&
      next !== undefined &&
      next.role === "tool_result" &&
      cur.invocationId !== undefined &&
      cur.invocationId === next.invocationId
    ) {
      out.push({ pair: [cur, next], key: `${cur.id}+${next.id}` });
      i++; // skip the consumed tool_result
    } else {
      out.push(cur);
    }
  }
  return out;
}

export function ConversationView({
  items,
  activeAssistantId,
  showWelcome,
  version,
  fullToolOutput,
}: ConversationViewProps): React.JSX.Element {
  // Cut at the active assistant turn. Items before it are immutable from
  // Ink's perspective (Static-safe); items from it onwards may still mutate.
  let cutIdx: number;
  if (activeAssistantId === null) {
    cutIdx = items.length;
  } else {
    const idx = items.findIndex(
      (it) => it.role === "assistant" && it.id === activeAssistantId,
    );
    cutIdx = idx === -1 ? items.length : idx;
  }
  const completed = items.slice(0, cutIdx);
  const active = items.slice(cutIdx);

  const completedGroups = groupAdjacentToolPairs(completed);
  const activeGroups = groupAdjacentToolPairs(active);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {showWelcome && completed.length === 0 && active.length === 0 && (
        <WelcomeBanner version={version} />
      )}
      <Static items={completedGroups}>
        {(g) => (
          <GroupBlock
            key={isPair(g) ? g.key : g.id}
            group={g}
            fullToolOutput={fullToolOutput}
          />
        )}
      </Static>
      {activeGroups.map((g) => (
        <GroupBlock
          key={isPair(g) ? g.key : g.id}
          group={g}
          fullToolOutput={fullToolOutput}
        />
      ))}
    </Box>
  );
}

function GroupBlock({
  group,
  fullToolOutput,
}: {
  group: GroupedItem;
  fullToolOutput: boolean;
}): React.JSX.Element {
  if (isPair(group)) {
    const [tool, result] = group.pair;
    return (
      <ToolCallDisplay tool={tool} result={result} fullToolOutput={fullToolOutput} />
    );
  }
  const item = group;
  if (item.role === "user") {
    return (
      <Box marginTop={1}>
        <Text dimColor>&gt; </Text>
        <Text>{item.text}</Text>
      </Box>
    );
  }
  if (item.role === "assistant") {
    return (
      <Box flexDirection="column">
        <MarkdownText source={item.text} cursor={item.done !== true} />
      </Box>
    );
  }
  if (item.role === "tool") {
    // Unpaired tool — still running (no matching result yet).
    return (
      <ToolCallDisplay
        tool={item}
        result={undefined}
        fullToolOutput={fullToolOutput}
      />
    );
  }
  if (item.role === "tool_result") {
    // Orphan tool_result (shouldn't happen in normal flow). Render as dim
    // text so we don't silently lose data.
    return (
      <Box marginLeft={2}>
        <Text dimColor>{item.text}</Text>
      </Box>
    );
  }
  // role === "system"
  return <SystemBlock item={item} />;
}

function SystemBlock({ item }: { item: TranscriptItem }): React.JSX.Element {
  const subkind = item.subkind;
  if (subkind === "sessions") {
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
  if (subkind === "tools") {
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
  if (subkind === "error") {
    return (
      <Box marginY={1}>
        <Text color="red">error: {String(item.payload)}</Text>
      </Box>
    );
  }
  // info / default
  return (
    <Box marginY={1}>
      <Text dimColor>{String(item.payload ?? item.text)}</Text>
    </Box>
  );
}
```

- [ ] **Step 2: 写测试 `tests/components/ConversationView.test.tsx`**

```typescript
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import {
  ConversationView,
  groupAdjacentToolPairs,
} from "../../src/components/ConversationView.js";
import { ThemeProvider } from "../../src/theme/ThemeContext.js";
import type { TranscriptItem } from "../../src/types.js";

describe("groupAdjacentToolPairs", () => {
  it("pairs adjacent tool + tool_result with matching invocationId", () => {
    const items: TranscriptItem[] = [
      { id: "t1", role: "user", text: "hi" },
      { id: "t2", role: "assistant", text: "running", done: false },
      {
        id: "t3",
        role: "tool",
        text: "",
        toolName: "Bash",
        toolInput: { cmd: "ls" },
        invocationId: "inv-1",
      },
      {
        id: "t4",
        role: "tool_result",
        text: "ok",
        invocationId: "inv-1",
        isError: false,
      },
    ];
    const grouped = groupAdjacentToolPairs(items);
    expect(grouped).toHaveLength(3); // user, assistant, [tool+result pair]
    const last = grouped[2] as { pair: [TranscriptItem, TranscriptItem]; key: string };
    expect(last.pair[0].id).toBe("t3");
    expect(last.pair[1].id).toBe("t4");
    expect(last.key).toBe("t3+t4");
  });

  it("leaves a running tool standalone when no result follows", () => {
    const items: TranscriptItem[] = [
      {
        id: "t1",
        role: "tool",
        text: "",
        toolName: "Bash",
        invocationId: "inv-1",
      },
    ];
    const grouped = groupAdjacentToolPairs(items);
    expect(grouped).toHaveLength(1);
    // Standalone — TranscriptItem object, not a pair
    expect((grouped[0] as TranscriptItem).id).toBe("t1");
  });

  it("does not pair when invocationId differs", () => {
    const items: TranscriptItem[] = [
      { id: "t1", role: "tool", text: "", toolName: "Bash", invocationId: "inv-1" },
      { id: "t2", role: "tool_result", text: "ok", invocationId: "inv-DIFFERENT", isError: false },
    ];
    const grouped = groupAdjacentToolPairs(items);
    expect(grouped).toHaveLength(2); // both standalone
  });
});

describe("ConversationView", () => {
  it("renders WelcomeBanner when transcript is empty and showWelcome=true", () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <ConversationView
          items={[]}
          activeAssistantId={null}
          showWelcome={true}
          version="0.4.0"
          fullToolOutput={false}
        />
      </ThemeProvider>,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("oh-mini-powered terminal coding agent");
    expect(frame).toContain("0.4.0");
  });

  it("renders a paired tool/tool_result as a single ToolCallDisplay block", () => {
    const items: TranscriptItem[] = [
      { id: "t1", role: "user", text: "list" },
      {
        id: "t2",
        role: "tool",
        text: "",
        toolName: "Bash",
        toolInput: { cmd: "ls" },
        invocationId: "inv-1",
      },
      {
        id: "t3",
        role: "tool_result",
        text: "file.txt",
        invocationId: "inv-1",
        isError: false,
      },
    ];
    const { lastFrame } = render(
      <ThemeProvider>
        <ConversationView
          items={items}
          activeAssistantId={null}
          showWelcome={false}
          version="0.4.0"
          fullToolOutput={false}
        />
      </ThemeProvider>,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Bash");
    expect(frame).toContain("file.txt");
    // 成功标识（default theme 是 ✓）
    expect(frame).toContain("✓");
  });

  it("renders a running tool (no result) with the ▸ marker", () => {
    const items: TranscriptItem[] = [
      {
        id: "t1",
        role: "tool",
        text: "",
        toolName: "Bash",
        toolInput: { cmd: "sleep 5" },
        invocationId: "inv-1",
      },
    ];
    const { lastFrame } = render(
      <ThemeProvider>
        <ConversationView
          items={items}
          activeAssistantId={null}
          showWelcome={false}
          version="0.4.0"
          fullToolOutput={false}
        />
      </ThemeProvider>,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Bash");
    expect(frame).toContain("▸");
  });
});
```

需要在 test 文件顶部加 `import type React from "react";` 才能用 JSX。

- [ ] **Step 3: 运行测试**

```bash
pnpm test ConversationView
```

预期：6 个测试 pass（3 个 groupAdjacentToolPairs + 3 个 ConversationView render）。

- [ ] **Step 4: typecheck**

```bash
pnpm typecheck
```

预期：T1 已知错误不变。

- [ ] **Step 5: Commit**

```bash
git add src/components/ConversationView.tsx tests/components/ConversationView.test.tsx
git commit -m "feat(tui): ConversationView with tool/tool_result pairing + Static cutoff

groupAdjacentToolPairs 用 invocationId 严格配对（比 OpenHarness 纯相邻假设更稳）。
Static 切分点是 activeAssistantId；其之前为 completed，进 <Static>；其之后
为 active，动态渲染。WelcomeBanner 仅在空 transcript + showWelcome 时显示。

测试：6 个用例覆盖配对逻辑（pair 成功 / 单 tool / invocationId 不匹配）
和渲染（WelcomeBanner / 配对 ToolCallDisplay / running tool）。"
```

---

### Task 7: StatusBar 重做 + 测试

**Files:**
- Rewrite: `src/components/StatusBar.tsx`
- Create: `tests/components/StatusBar.test.tsx`

- [ ] **Step 1: Rewrite `src/components/StatusBar.tsx`**

```typescript
/**
 * StatusBar — OpenHarness 风格分隔符行。
 *
 * 顶部一条 ── 分隔线；下方一行用 │ 分段显示：
 *   model: X │ tokens: 1.2k↓ 3.4k↑ │ mode: yolo │ sess a1b2c3d4 │ [cancel hint]
 * 各段只在数据存在时显示。
 */

import type React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/ThemeContext.js";

export interface StatusBarProps {
  provider: string | null;
  model: string | null;
  profile?: string | null;
  sessionIdShort: string | null;
  yolo: boolean;
  /** Token counters from telemetry, if available. */
  tokens?: { input: number; output: number } | null;
  /** Legacy: telemetry pulse string surfacing event_type + duration. */
  telemetry?: { event_type: string; elapsed_ms: number } | null;
  cancelHint?: string | null;
}

const SEP = " │ ";

export function StatusBar({
  provider,
  model,
  profile,
  sessionIdShort,
  yolo,
  tokens,
  telemetry,
  cancelHint,
}: StatusBarProps): React.JSX.Element {
  const { theme } = useTheme();

  const segments: React.ReactNode[] = [];

  // model + provider
  const modelLabel = model ?? "unknown";
  const providerLabel = provider ?? "unknown";
  segments.push(
    <Text key="model" color={theme.colors.primary} dimColor>
      model: {modelLabel}
    </Text>,
  );
  segments.push(
    <Text key="provider" dimColor>
      provider: {providerLabel}
    </Text>,
  );

  if (tokens !== null && tokens !== undefined && (tokens.input > 0 || tokens.output > 0)) {
    segments.push(
      <Text key="tokens" dimColor>
        tokens: {formatNum(tokens.input)}↓ {formatNum(tokens.output)}↑
      </Text>,
    );
  }

  if (yolo) {
    segments.push(
      <Text key="mode" dimColor>
        mode: yolo
      </Text>,
    );
  }

  if (profile !== null && profile !== undefined && profile !== "default") {
    segments.push(
      <Text key="profile" dimColor>
        @{profile}
      </Text>,
    );
  }

  if (sessionIdShort !== null) {
    segments.push(
      <Text key="sess" dimColor>
        sess {sessionIdShort}
      </Text>,
    );
  }

  if (cancelHint !== null && cancelHint !== undefined) {
    segments.push(
      <Text key="hint" color={theme.colors.warning}>
        {cancelHint}
      </Text>,
    );
  } else if (telemetry !== null && telemetry !== undefined) {
    segments.push(
      <Text key="telemetry" dimColor>
        {telemetry.event_type} · {telemetry.elapsed_ms}ms
      </Text>,
    );
  }

  return (
    <Box flexDirection="column" width="100%">
      <Text dimColor>{"─".repeat(60)}</Text>
      <Box>
        <Text>
          {segments.flatMap((seg, i) =>
            i === 0 ? [seg] : [<Text key={`s${i}`} dimColor>{SEP}</Text>, seg],
          )}
        </Text>
      </Box>
    </Box>
  );
}

function formatNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
```

- [ ] **Step 2: 写测试 `tests/components/StatusBar.test.tsx`**

```typescript
import type React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { StatusBar } from "../../src/components/StatusBar.js";
import { ThemeProvider } from "../../src/theme/ThemeContext.js";

function r(props: Parameters<typeof StatusBar>[0]) {
  return render(
    <ThemeProvider>
      <StatusBar {...props} />
    </ThemeProvider>,
  );
}

describe("StatusBar", () => {
  it("renders model + provider + sess segments by default", () => {
    const { lastFrame } = r({
      provider: "deepseek",
      model: "deepseek-chat",
      sessionIdShort: "a1b2c3d4",
      yolo: false,
    });
    const f = lastFrame() ?? "";
    expect(f).toContain("model: deepseek-chat");
    expect(f).toContain("provider: deepseek");
    expect(f).toContain("sess a1b2c3d4");
    expect(f).toContain("│");
  });

  it("hides the tokens segment when null", () => {
    const { lastFrame } = r({
      provider: null,
      model: null,
      sessionIdShort: null,
      yolo: false,
      tokens: null,
    });
    expect(lastFrame() ?? "").not.toContain("tokens:");
  });

  it("shows tokens segment when both counters are positive", () => {
    const { lastFrame } = r({
      provider: null,
      model: null,
      sessionIdShort: null,
      yolo: false,
      tokens: { input: 1234, output: 5678 },
    });
    const f = lastFrame() ?? "";
    expect(f).toContain("tokens:");
    expect(f).toContain("1.2k↓");
    expect(f).toContain("5.7k↑");
  });

  it("shows mode: yolo when yolo=true", () => {
    const { lastFrame } = r({
      provider: null,
      model: null,
      sessionIdShort: null,
      yolo: true,
    });
    expect(lastFrame() ?? "").toContain("mode: yolo");
  });

  it("hides yolo segment when yolo=false", () => {
    const { lastFrame } = r({
      provider: null,
      model: null,
      sessionIdShort: null,
      yolo: false,
    });
    expect(lastFrame() ?? "").not.toContain("mode:");
  });

  it("shows cancelHint instead of telemetry when both present", () => {
    const { lastFrame } = r({
      provider: null,
      model: null,
      sessionIdShort: null,
      yolo: false,
      telemetry: { event_type: "iteration_completed", elapsed_ms: 300 },
      cancelHint: "Ctrl+C to cancel",
    });
    const f = lastFrame() ?? "";
    expect(f).toContain("Ctrl+C to cancel");
    expect(f).not.toContain("iteration_completed");
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
pnpm test StatusBar
```

预期：6 个测试 pass。

- [ ] **Step 4: typecheck**

```bash
pnpm typecheck
```

T1 旧错误依旧；StatusBar 自身无错。`ReplMode` / `OneShotMode` 仍会引用 StatusBar 的旧 props 签名——但因为我们**扩展**了 props（保留 telemetry，新加 tokens），向后兼容。

- [ ] **Step 5: Commit**

```bash
git add src/components/StatusBar.tsx tests/components/StatusBar.test.tsx
git commit -m "feat(tui): StatusBar 重做 — │ 分隔 + 可选 tokens 段

OpenHarness 风格：── 分隔线 + │ 分隔段；按数据存在性动态展段：
model / provider / [tokens] / [mode: yolo] / [@profile] / sess / [hint|telemetry]。
cancelHint 优先于 telemetry 显示。

向后兼容：保留旧 telemetry prop，新加 tokens prop（默认 null 隐藏）。"
```

---

### Task 8: Footer 组件

**Files:**
- Create: `src/components/Footer.tsx`

- [ ] **Step 1: Create `src/components/Footer.tsx`**

```typescript
/**
 * Footer — single line at the bottom of the screen with static environment
 * info. Mirrors OpenHarness's bottom-line summary but trimmed to the subset
 * oh-mini actually surfaces.
 */

import type React from "react";
import { Box, Text } from "ink";

export interface FooterProps {
  provider: string | null;
  model: string | null;
  sessionIdShort: string | null;
  yolo: boolean;
  authStatus?: string;
}

export function Footer({
  provider,
  model,
  sessionIdShort,
  yolo,
  authStatus = "ok",
}: FooterProps): React.JSX.Element {
  return (
    <Box marginTop={1}>
      <Text dimColor>
        model={model ?? "unknown"} provider={provider ?? "unknown"}{" "}
        auth={authStatus} yolo={String(yolo)}{" "}
        session={sessionIdShort ?? "—"}
      </Text>
    </Box>
  );
}
```

- [ ] **Step 2: typecheck**

```bash
pnpm typecheck
```

T1 旧错误不变。

- [ ] **Step 3: Commit**

```bash
git add src/components/Footer.tsx
git commit -m "feat(tui): Footer with single-line static env info

OpenHarness 风格底栏；oh-mini 不暴露 mcp/bridge/vim/voice/effort/passes
所以这些段省略。auth 在 ready 时一定通过（bridge 已连上），固定显示 ok。"
```

---

### Task 9: replay.ts 适配新 TranscriptItem 模型 + 测试更新

**Files:**
- Rewrite: `src/lib/replay.ts`
- Update: `tests/lib/replay.test.ts`

- [ ] **Step 1: Rewrite `src/lib/replay.ts`**

```typescript
/**
 * Convert a Message[] (as returned by `session.load`) into TranscriptItem[].
 *
 * After the Phase 14a model refresh, tool_call and tool_result blocks become
 * top-level rows linked by invocationId, rather than nested under an
 * assistant row's toolCalls array.
 *
 * Wire shape (mirrors meta-harney pydantic Message):
 *   role: "user" | "assistant" | "system" | "tool"
 *   content: ContentBlock[]   // discriminated by `type`
 *
 * ContentBlock variants:
 *   - text          { type: "text", text }
 *   - tool_call     { type: "tool_call", invocation_id, name, args? }
 *     (legacy alias `tool_use` accepted)
 *   - tool_result   { type: "tool_result", invocation_id, success?, output?, error? }
 *
 * v1 limitations:
 *   - Only text blocks render with full fidelity on assistant rows.
 *   - Replayed assistant items mark done: true (no streaming cursor).
 *   - "tool"-role messages walk their content blocks for tool_result entries
 *     and push them as top-level rows in order.
 */

import type { TranscriptItem } from "../types.js";

interface RawMessage {
  role?: unknown;
  content?: unknown;
}

interface RawBlock {
  type?: unknown;
  text?: unknown;
  name?: unknown;
  invocation_id?: unknown;
  invocationId?: unknown;
  args?: unknown;
  output?: unknown;
  error?: unknown;
  success?: unknown;
  is_error?: unknown;
}

let _replayCounter = 0;
function replayId(): string {
  _replayCounter += 1;
  return `replay-${_replayCounter}`;
}

export function messagesToTranscript(messages: unknown): TranscriptItem[] {
  if (!Array.isArray(messages)) return [];
  const items: TranscriptItem[] = [];

  for (const m of messages) {
    if (typeof m !== "object" || m === null) continue;
    const msg = m as RawMessage;
    if (!Array.isArray(msg.content)) continue;
    const blocks = msg.content as unknown[];

    if (msg.role === "user") {
      items.push({
        id: replayId(),
        role: "user",
        text: extractText(blocks),
      });
      continue;
    }

    if (msg.role === "assistant") {
      const text = extractText(blocks);
      // Push the assistant text first (if any), then tool_calls / tool_results
      // in source order as top-level rows.
      if (text.length > 0) {
        items.push({
          id: replayId(),
          role: "assistant",
          text,
          done: true,
        });
      }
      for (const b of blocks) {
        if (typeof b !== "object" || b === null) continue;
        const blk = b as RawBlock;
        const type = blk.type;
        if ((type === "tool_call" || type === "tool_use") && typeof blk.name === "string") {
          items.push({
            id: replayId(),
            role: "tool",
            text: "",
            toolName: blk.name,
            toolInput: blk.args ?? null,
            invocationId: invocationIdOf(blk) ?? replayId(),
          });
        } else if (type === "tool_result") {
          const invocationId = invocationIdOf(blk);
          if (invocationId === undefined) continue;
          items.push({
            id: replayId(),
            role: "tool_result",
            text: resultTextOf(blk),
            invocationId,
            isError: isErrorOf(blk),
          });
        }
      }
      continue;
    }

    if (msg.role === "system") {
      items.push({
        id: replayId(),
        role: "system",
        subkind: "info",
        payload: extractText(blocks),
        text: extractText(blocks),
      });
      continue;
    }

    if (msg.role === "tool") {
      // tool-role messages carry tool_result blocks. Push each as a top-level
      // tool_result row, in order.
      for (const b of blocks) {
        if (typeof b !== "object" || b === null) continue;
        const blk = b as RawBlock;
        if (blk.type !== "tool_result") continue;
        const invocationId = invocationIdOf(blk);
        if (invocationId === undefined) continue;
        items.push({
          id: replayId(),
          role: "tool_result",
          text: resultTextOf(blk),
          invocationId,
          isError: isErrorOf(blk),
        });
      }
      continue;
    }

    // Unknown roles: skip silently.
  }

  return items;
}

function extractText(blocks: unknown[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (typeof b !== "object" || b === null) continue;
    const blk = b as RawBlock;
    if (blk.type === "text" && typeof blk.text === "string") {
      parts.push(blk.text);
    }
  }
  return parts.join("");
}

function invocationIdOf(blk: RawBlock): string | undefined {
  if (typeof blk.invocation_id === "string" && blk.invocation_id.length > 0) {
    return blk.invocation_id;
  }
  if (typeof blk.invocationId === "string" && blk.invocationId.length > 0) {
    return blk.invocationId;
  }
  return undefined;
}

function isErrorOf(blk: RawBlock): boolean {
  if (blk.success === false) return true;
  if (blk.is_error === true) return true;
  if (typeof blk.error === "string" && blk.error.length > 0) return true;
  return false;
}

function resultTextOf(blk: RawBlock): string {
  if (typeof blk.error === "string" && blk.error.length > 0) {
    return blk.error;
  }
  const out = blk.output;
  if (typeof out === "string") return out;
  if (out !== undefined && out !== null) {
    try {
      return JSON.stringify(out);
    } catch {
      return "";
    }
  }
  return "";
}
```

- [ ] **Step 2: 读现有 `tests/lib/replay.test.ts`**

```bash
cat tests/lib/replay.test.ts
```

测试当前断言 ToolCallState 嵌套结构。我们要把所有断言改成顶层 tool / tool_result 模型。

- [ ] **Step 3: Update `tests/lib/replay.test.ts`**

完全替换文件内容（保留原 import 风格）：

```typescript
import { describe, it, expect } from "vitest";
import { messagesToTranscript } from "../../src/lib/replay.js";

describe("messagesToTranscript", () => {
  it("returns [] for non-array input", () => {
    expect(messagesToTranscript(null)).toEqual([]);
    expect(messagesToTranscript("nope")).toEqual([]);
  });

  it("converts a user text message", () => {
    const items = messagesToTranscript([
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ role: "user", text: "hi" });
  });

  it("converts an assistant text-only message", () => {
    const items = messagesToTranscript([
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      role: "assistant",
      text: "hello",
      done: true,
    });
  });

  it("emits top-level tool + tool_result rows for assistant tool_call + same-message tool_result", () => {
    const items = messagesToTranscript([
      {
        role: "assistant",
        content: [
          { type: "text", text: "running" },
          {
            type: "tool_call",
            invocation_id: "inv-1",
            name: "Bash",
            args: { cmd: "ls" },
          },
          {
            type: "tool_result",
            invocation_id: "inv-1",
            output: "file.txt\n",
          },
        ],
      },
    ]);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ role: "assistant", text: "running" });
    expect(items[1]).toMatchObject({
      role: "tool",
      toolName: "Bash",
      invocationId: "inv-1",
    });
    expect(items[2]).toMatchObject({
      role: "tool_result",
      text: "file.txt\n",
      invocationId: "inv-1",
      isError: false,
    });
  });

  it("emits tool_result rows from a tool-role message", () => {
    const items = messagesToTranscript([
      {
        role: "assistant",
        content: [
          {
            type: "tool_call",
            invocation_id: "inv-2",
            name: "Read",
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool_result",
            invocation_id: "inv-2",
            output: "contents",
          },
        ],
      },
    ]);
    // No assistant text → no assistant item; only tool + tool_result
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ role: "tool", invocationId: "inv-2" });
    expect(items[1]).toMatchObject({
      role: "tool_result",
      text: "contents",
      invocationId: "inv-2",
      isError: false,
    });
  });

  it("marks isError=true for tool_result with success=false", () => {
    const items = messagesToTranscript([
      {
        role: "tool",
        content: [
          {
            type: "tool_result",
            invocation_id: "inv-3",
            success: false,
            error: "boom",
          },
        ],
      },
    ]);
    expect(items[0]).toMatchObject({
      role: "tool_result",
      text: "boom",
      isError: true,
    });
  });

  it("accepts legacy tool_use alias", () => {
    const items = messagesToTranscript([
      {
        role: "assistant",
        content: [
          { type: "tool_use", invocation_id: "inv-4", name: "Grep" },
        ],
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ role: "tool", toolName: "Grep" });
  });
});
```

- [ ] **Step 4: 运行测试**

```bash
pnpm test replay
```

预期：7 个测试 pass。

- [ ] **Step 5: typecheck**

```bash
pnpm typecheck
```

预期：T1 旧错误**减少**——replay.ts 不再引用旧 `ToolCallState`。但 ReplMode / OneShotMode / TranscriptItemView 仍有错误，T10 删除。

- [ ] **Step 6: Commit**

```bash
git add src/lib/replay.ts tests/lib/replay.test.ts
git commit -m "feat(replay): emit top-level tool/tool_result rows on session resume

ContentBlock 历史展开为顶层 transcript 项而不是嵌入 assistant.toolCalls。
配对关系由 invocationId 显式承载，ConversationView 在 T6 用 invocationId
+ 相邻假设重新组合显示。测试同步重写，覆盖 7 个用例。"
```

---

### Task 10: App.tsx 重写 + cli.tsx flag 扩展 + 删旧文件

**Files:**
- Rewrite: `src/App.tsx`
- Modify: `src/cli.tsx`
- Delete: `src/modes/ReplMode.tsx`
- Delete: `src/modes/OneShotMode.tsx`
- Delete: `src/components/TranscriptItemView.tsx`
- Delete: `src/components/ToolCallView.tsx`
- Delete: `src/components/StreamingMessage.tsx`

这是 plan 里最大的一步。我们分**两个 commit**：先**等价迁移**（行为不变，旧组件还在但 App.tsx 路由换成新 App），再**清理**（删旧文件 + 切换到新 ConversationView / StatusBar new shape）。

- [ ] **Step 1: Rewrite `src/App.tsx`**

```typescript
/**
 * App — single Ink component that drives oh-tui.
 *
 * Replaces the modes/ReplMode + modes/OneShotMode split. The `--prompt` flag
 * (or a single positional argument) seeds the first user turn; `--exit-on-done`
 * exits Ink after that first turn finishes (== the old OneShotMode behavior).
 * Without `--exit-on-done`, App stays in REPL mode and accepts more input.
 *
 * State + events follow the Phase 12 ReplMode shape, adapted to the flat
 * TranscriptItem model from T1: text_delta still appends to the active
 * assistant turn; tool_call_started pushes a top-level "tool" row;
 * tool_call_completed pushes a top-level "tool_result" row.
 */

import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useApp } from "ink";
import {
  BridgeCancelled,
  type PermissionDecision,
  type SendMessageHandle,
} from "@meta-harney/bridge-client";
import { useBridgeClient } from "./hooks/useBridgeClient.js";
import { useCancelOrExit } from "./hooks/useKeybinds.js";
import { useTranscript } from "./hooks/useTranscript.js";
import { ConversationView } from "./components/ConversationView.js";
import { Footer } from "./components/Footer.js";
import { PermissionDialog } from "./components/PermissionDialog.js";
import { PromptInput } from "./components/PromptInput.js";
import {
  SelectModal,
  type SelectOption,
} from "./components/SelectModal.js";
import { Spinner } from "./components/Spinner.js";
import { StatusBar } from "./components/StatusBar.js";
import { TodoPanel, parseTodos, type TodoItem } from "./components/TodoPanel.js";
import { messagesToTranscript } from "./lib/replay.js";
import { ThemeProvider } from "./theme/ThemeContext.js";
import type { CliArgs, TranscriptItem } from "./types.js";

const VERSION = "0.4.0";
const EXIT_HOLD_MS = 100;

export interface AppProps {
  args: CliArgs;
}

export function App({ args }: AppProps): React.JSX.Element {
  return (
    <ThemeProvider initialTheme={args.theme}>
      <AppInner args={args} />
    </ThemeProvider>
  );
}

interface PendingPermission {
  tool: string;
  args: unknown;
  resolve: (decision: PermissionDecision) => void;
}

interface StreamEventLike {
  kind?: string;
  text?: string;
  tool?: string;
  tool_name?: string;
  invocation_id?: string;
  invocationId?: string;
  args?: unknown;
  result?: unknown;
  error?: unknown;
  is_error?: boolean;
}

function eventToolName(e: StreamEventLike): string {
  return e.tool_name ?? e.tool ?? "tool";
}
function eventInvocationId(e: StreamEventLike): string | undefined {
  return e.invocationId ?? e.invocation_id;
}
function eventIsError(e: StreamEventLike): boolean {
  if (e.error !== undefined && e.error !== null) return true;
  if (e.is_error === true) return true;
  const result = e.result;
  if (
    result !== undefined &&
    result !== null &&
    typeof result === "object" &&
    "is_error" in (result as Record<string, unknown>)
  ) {
    return (result as { is_error?: unknown }).is_error === true;
  }
  return false;
}
function eventResultText(e: StreamEventLike): string {
  const r = e.result;
  if (typeof r === "string") return r;
  if (r !== undefined && r !== null && typeof r === "object") {
    try {
      return JSON.stringify(r);
    } catch {
      return "";
    }
  }
  if (typeof e.error === "string") return e.error;
  return "";
}

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

const MODEL_OPTIONS: Record<string, string[]> = {
  anthropic: ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  moonshot: ["kimi-k2-0905-preview"],
  gemini: ["gemini-2.0-flash", "gemini-1.5-pro"],
  minimax: ["MiniMax-M2"],
  nvidia: ["meta/llama-3.1-405b-instruct"],
  dashscope: ["qwen-max", "qwen-plus", "qwen-turbo"],
  modelscope: ["Qwen2.5-72B-Instruct"],
};

const PROFILE_OPTIONS: SelectOption[] = [
  { value: "default", label: "default" },
  {
    value: "work",
    label: "work",
    hint: "requires `oh auth login --profile work`",
  },
];

function AppInner({ args }: AppProps): React.JSX.Element {
  const { client, ready, error, effective, restart } = useBridgeClient(args);
  const transcript = useTranscript();
  const [history, setHistory] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [permission, setPermission] = useState<PendingPermission | null>(null);
  const [runtimeError, setRuntimeError] = useState<Error | null>(null);
  const [telemetry, setTelemetry] = useState<{ event_type: string; elapsed_ms: number } | null>(null);
  const [waitingForFirstToken, setWaitingForFirstToken] = useState(false);
  const [exitHintVisible, setExitHintVisible] = useState(false);
  const [sessionsModal, setSessionsModal] = useState<{ options: SelectOption[] } | null>(null);
  const [activeArgs, setActiveArgs] = useState<CliArgs>(args);
  const [providerModal, setProviderModal] = useState<SelectOption[] | null>(null);
  const [modelModal, setModelModal] = useState<SelectOption[] | null>(null);
  const [profileModal, setProfileModal] = useState<SelectOption[] | null>(null);
  const [, setActiveBump] = useState(0);
  const [latestTodos, setLatestTodos] = useState<TodoItem[] | null>(null);

  const handleRef = useRef<SendMessageHandle | null>(null);
  const activeAssistantIdRef = useRef<string | null>(null);
  const sentInitialRef = useRef(false);
  const exitTimerRef = useRef<NodeJS.Timeout | null>(null);
  const app = useApp();

  // telemetry subscription
  useEffect(() => {
    if (client === null) return;
    client.onTelemetry((ev) => {
      const payload = ev.payload as { duration_ms?: number } | null;
      const elapsed =
        payload !== null && typeof payload.duration_ms === "number"
          ? payload.duration_ms
          : 0;
      setTelemetry({ event_type: ev.event_type, elapsed_ms: Math.round(elapsed) });
    });
    void client.telemetrySubscribe(true).catch(() => {});
  }, [client]);

  useCancelOrExit({
    getInflight: () => handleRef.current,
    onExit: () => app.exit(),
    onHint: setExitHintVisible,
  });

  const submit = useCallback(
    (prompt: string): void => {
      if (client === null) return;
      if (prompt === "/exit" || prompt === "/quit") {
        app.exit();
        return;
      }
      const resumeMatch = /^\/resume\s+(\S+)$/.exec(prompt);
      if (resumeMatch !== null) {
        const id = resumeMatch[1]!;
        void (async () => {
          try {
            const session = await client.sessionLoad(id);
            transcript.replayMessages(messagesToTranscript(session.messages));
            setSessionId(session.id);
            transcript.appendSystem(
              "info",
              `resumed session ${session.id.slice(0, 8)}…`,
            );
          } catch (e) {
            transcript.appendSystem("error", (e as Error).message);
          }
        })();
        return;
      }
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
                label: `${s.id.slice(0, 12)}…`,
                hint: `${s.message_count} msgs · ${s.created_at.slice(0, 19)}`,
              })),
            });
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
      if (prompt === "/provider") {
        setProviderModal(PROVIDER_OPTIONS);
        return;
      }
      if (prompt === "/model") {
        const provider = activeArgs.provider ?? "anthropic";
        const models = MODEL_OPTIONS[provider] ?? [];
        if (models.length === 0) {
          transcript.appendSystem(
            "info",
            `no known models for ${provider}; use --model <name> at launch`,
          );
          return;
        }
        setModelModal(models.map((m) => ({ value: m, label: m })));
        return;
      }
      if (prompt === "/profile") {
        setProfileModal(PROFILE_OPTIONS);
        return;
      }
      if (prompt.trim() === "") return;

      setHistory((h) => [...h, prompt]);
      transcript.appendUser(prompt);
      const assistantId = transcript.appendAssistant();
      activeAssistantIdRef.current = assistantId;
      setActiveBump((n) => n + 1);
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
              if (chunk.length === 0) return;
              setWaitingForFirstToken(false);
              transcript.appendToken(assistantId, chunk);
              return;
            }

            if (kind === "tool_call_started" || kind === "tool_use") {
              setWaitingForFirstToken(false);
              const invocationId =
                eventInvocationId(ev) ?? `inv-${Math.random().toString(36).slice(2)}`;
              const toolName = eventToolName(ev);
              transcript.appendTool(invocationId, toolName, ev.args ?? null);
              // Track todo_write specifically so we can render TodoPanel.
              if (toolName === "todo_write") {
                const parsed = parseTodos(ev.args);
                if (parsed !== null) setLatestTodos(parsed);
              }
              return;
            }

            if (kind === "tool_call_completed" || kind === "tool_result") {
              const invocationId = eventInvocationId(ev);
              if (invocationId === undefined) return;
              transcript.appendToolResult(invocationId, eventResultText(ev), eventIsError(ev));
              return;
            }
          });

          await handle.done;
        } catch (e) {
          if (!(e instanceof BridgeCancelled)) {
            transcript.appendSystem("error", (e as Error).message);
            if (sessionId === null) setRuntimeError(e as Error);
          }
        } finally {
          if (handleRef.current === handle) handleRef.current = null;
          if (activeAssistantIdRef.current === assistantId) {
            activeAssistantIdRef.current = null;
            setActiveBump((n) => n + 1);
          }
          setWaitingForFirstToken(false);
          transcript.finishAssistant(assistantId);
          // --exit-on-done: schedule app.exit after the final frame paints.
          if (activeArgs.exitOnDone && sentInitialRef.current) {
            if (exitTimerRef.current !== null) clearTimeout(exitTimerRef.current);
            exitTimerRef.current = setTimeout(() => app.exit(), EXIT_HOLD_MS);
          }
        }
      })();
    },
    [client, sessionId, transcript, app, activeArgs],
  );

  // initial_prompt: fire once when bridge is ready.
  useEffect(() => {
    if (!ready || client === null) return;
    if (args.prompt === null) return;
    if (sentInitialRef.current) return;
    sentInitialRef.current = true;
    submit(args.prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, client]);

  // /provider /model /profile shared switch flow
  const performSwitch = useCallback(
    async (patch: Partial<CliArgs>, label: string): Promise<void> => {
      handleRef.current?.cancel().catch(() => {});
      transcript.appendSystem("info", `switching to ${label}…`);
      const next: CliArgs = { ...activeArgs, ...patch };
      setActiveArgs(next);
      try {
        const newClient = await restart(next);
        if (sessionId !== null) {
          try {
            const session = await newClient.sessionLoad(sessionId);
            transcript.replayMessages(messagesToTranscript(session.messages));
            transcript.appendSystem(
              "info",
              `session ${session.id.slice(0, 8)}… reloaded`,
            );
          } catch (e) {
            transcript.appendSystem(
              "error",
              `session reload failed: ${(e as Error).message}`,
            );
          }
        }
      } catch (e) {
        transcript.appendSystem("error", (e as Error).message);
      }
    },
    [activeArgs, restart, sessionId, transcript],
  );

  const handleSwitchProvider = useCallback(
    (newProvider: string): void => {
      setProviderModal(null);
      void performSwitch({ provider: newProvider, model: null }, `provider ${newProvider}`);
    },
    [performSwitch],
  );
  const handleSwitchModel = useCallback(
    (newModel: string): void => {
      setModelModal(null);
      void performSwitch({ model: newModel }, `model ${newModel}`);
    },
    [performSwitch],
  );
  const handleSwitchProfile = useCallback(
    (newProfile: string): void => {
      setProfileModal(null);
      void performSwitch({ profile: newProfile }, `profile ${newProfile}`);
    },
    [performSwitch],
  );

  if (error !== null) return <Text color="red">error: {error.message}</Text>;
  if (runtimeError !== null) return <Text color="red">error: {runtimeError.message}</Text>;
  if (!ready || client === null) return <Text dimColor>connecting…</Text>;

  const sessionShort = sessionId !== null ? `${sessionId.slice(0, 8)}…` : null;
  const cancelHint: string | null = exitHintVisible
    ? "press Ctrl+C again to exit"
    : handleRef.current !== null
      ? "Ctrl+C to cancel"
      : null;

  // showWelcome: only when transcript is empty and we're not auto-submitting
  // an initial prompt (which immediately appends a user item, hiding welcome).
  const showWelcome = transcript.items.length === 0 && args.prompt === null;

  return (
    <Box flexDirection="column">
      <ConversationView
        items={transcript.items}
        activeAssistantId={activeAssistantIdRef.current}
        showWelcome={showWelcome}
        version={VERSION}
        fullToolOutput={activeArgs.fullToolOutput}
      />
      {latestTodos !== null && <TodoPanel todos={latestTodos} />}
      <Spinner active={waitingForFirstToken} />
      {permission !== null && (
        <PermissionDialog
          tool={permission.tool}
          args={permission.args}
          onDecide={permission.resolve}
        />
      )}
      {permission === null && sessionsModal !== null && (
        <SelectModal
          title="resume session"
          options={sessionsModal.options}
          onSelect={(id) => {
            setSessionsModal(null);
            submit(`/resume ${id}`);
          }}
          onCancel={() => setSessionsModal(null)}
        />
      )}
      {permission === null && sessionsModal === null && providerModal !== null && (
        <SelectModal
          title="switch provider"
          options={providerModal}
          onSelect={handleSwitchProvider}
          onCancel={() => setProviderModal(null)}
        />
      )}
      {permission === null &&
        sessionsModal === null &&
        providerModal === null &&
        modelModal !== null && (
          <SelectModal
            title="switch model"
            options={modelModal}
            onSelect={handleSwitchModel}
            onCancel={() => setModelModal(null)}
          />
        )}
      {permission === null &&
        sessionsModal === null &&
        providerModal === null &&
        modelModal === null &&
        profileModal !== null && (
          <SelectModal
            title="switch profile"
            options={profileModal}
            onSelect={handleSwitchProfile}
            onCancel={() => setProfileModal(null)}
          />
        )}
      <PromptInput history={history} onSubmit={submit} />
      <StatusBar
        provider={activeArgs.provider ?? effective.provider}
        model={activeArgs.model ?? effective.model}
        profile={activeArgs.profile}
        sessionIdShort={sessionShort}
        yolo={activeArgs.yolo}
        telemetry={telemetry}
        cancelHint={cancelHint}
      />
      <Footer
        provider={activeArgs.provider ?? effective.provider}
        model={activeArgs.model ?? effective.model}
        sessionIdShort={sessionShort}
        yolo={activeArgs.yolo}
      />
    </Box>
  );
}
```

- [ ] **Step 2: Modify `src/cli.tsx`**

替换整个文件：

```typescript
#!/usr/bin/env node
/**
 * oh-tui CLI entry: parse argv, handle --help/--version, then render Ink App.
 */

import { render } from "ink";
import { App } from "./App.js";
import { teardownActiveBridge } from "./hooks/useBridgeClient.js";
import type { CliArgs } from "./types.js";

const VERSION = "0.4.0";

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    prompt: null,
    exitOnDone: false,
    theme: "default",
    provider: null,
    profile: null,
    model: null,
    framing: "newline",
    bridgeBin: "oh",
    bridgeArgs: [],
    yolo: false,
    fullToolOutput: false,
  };
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--prompt") {
      args.prompt = argv[++i] ?? null;
    } else if (a === "--exit-on-done") {
      args.exitOnDone = true;
    } else if (a === "--theme") {
      args.theme = argv[++i] ?? "default";
    } else if (a === "--provider") {
      args.provider = argv[++i] ?? null;
    } else if (a === "--profile") {
      args.profile = argv[++i] ?? null;
    } else if (a === "--model") {
      args.model = argv[++i] ?? null;
    } else if (a === "--framing") {
      const v = argv[++i];
      if (v === "newline" || v === "content-length") {
        args.framing = v;
      } else {
        console.error(`oh-tui: --framing expects 'newline' or 'content-length', got ${v ?? "(missing)"}`);
        process.exit(2);
      }
    } else if (a === "--bridge-bin") {
      args.bridgeBin = argv[++i] ?? "oh";
    } else if (a === "--yolo") {
      args.yolo = true;
    } else if (a === "--full-tool-output") {
      args.fullToolOutput = true;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else if (a === "--version") {
      console.log(`oh-tui ${VERSION}`);
      process.exit(0);
    } else if (a.startsWith("--")) {
      console.error(`oh-tui: unknown option ${a}`);
      process.exit(2);
    } else {
      rest.push(a);
    }
  }

  // Positional argument = legacy OneShotMode behavior: --prompt + --exit-on-done.
  if (rest.length > 0 && args.prompt === null) {
    args.prompt = rest.join(" ");
    args.exitOnDone = true;
  }
  return args;
}

function printHelp(): void {
  console.log(`oh-tui [prompt] — Ink TUI for oh-mini

Usage:
  oh-tui                       start interactive REPL
  oh-tui "your prompt here"    legacy one-shot mode (= --prompt X --exit-on-done)
  oh-tui --prompt "X"          inject initial prompt then stay in REPL
  oh-tui --prompt "X" --exit-on-done   inject initial prompt then exit when done

Options:
  --prompt <text>              initial prompt (auto-submitted when bridge ready)
  --exit-on-done               exit after the first turn finishes
  --theme <name>               default | dark | minimal (default: default)
  --provider X                 provider name
  --profile P                  credentials profile
  --model M                    model override
  --framing F                  newline (default) | content-length
  --bridge-bin PATH            override path to the \`oh\` executable
  --yolo                       skip permission dialogs
  --full-tool-output           disable 5-line tool result truncation
  -h, --help                   show this help and exit
  --version                    print version and exit`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const inst = render(<App args={args} />, { exitOnCtrlC: false });
  await inst.waitUntilExit();
  await Promise.race([
    teardownActiveBridge(),
    new Promise<void>((r) => setTimeout(r, 6000)),
  ]);
  process.exit(0);
}

void main();
```

- [ ] **Step 3: 删除旧文件**

```bash
git rm src/modes/ReplMode.tsx
git rm src/modes/OneShotMode.tsx
rmdir src/modes 2>/dev/null || true
git rm src/components/TranscriptItemView.tsx
git rm src/components/ToolCallView.tsx
git rm src/components/StreamingMessage.tsx
```

- [ ] **Step 4: 删除 useTranscript 的兼容垫片**

打开 `src/hooks/useTranscript.ts`，删除 T1 末尾加的 `appendToolCall` / `updateToolCall` no-op shims（包括 return 块里的两个键）。

- [ ] **Step 5: typecheck**

```bash
pnpm typecheck
```

预期：**全部通过**。如果还有错，根据错误信息修复（最可能是某处仍 import 已删除的组件 / 旧 API）。

- [ ] **Step 6: 运行所有测试**

```bash
pnpm test
```

预期：全部 pass（T1-T9 已建立的 25+ 测试用例）。

- [ ] **Step 7: 手工 smoke**

启动 dev REPL，逐条验证：

```bash
pnpm start
```

1. WelcomeBanner LOGO 在空会话首屏出现 ✓
2. 输入 `hello` → spinner → MarkdownText 流式渲染 → Welcome 消失，转入 transcript ✓
3. 让 LLM 用工具（如 `请用 Bash 列出 /tmp 文件`）→ 顶层显示 `▸ Bash` running → 完成后变 `✓ Bash` + 结果摘要 ✓
4. `/sessions` → SelectModal 出现，列出 sessions（或 "no sessions yet"）✓
5. StatusBar 显示 `model: X │ provider: Y │ sess Z`；`--yolo` 启动时显示 mode: yolo ✓
6. Footer 一行可读：`model=X provider=Y auth=ok yolo=false session=…` ✓
7. Ctrl+C 在 idle / running 两种状态行为正确（双击退出 / 单击取消）✓

退出 REPL，测 `--theme`：

```bash
pnpm start -- --theme dark
pnpm start -- --theme minimal
```

8. 整体配色按主题变化 ✓

测 `--prompt`：

```bash
pnpm start -- --prompt "hi" --exit-on-done
```

9. 自动提交 `hi` → 完成后退出 ✓

```bash
pnpm start -- --prompt "hi"
```

10. 自动提交 `hi` → 留在 REPL ✓

测位置参数兼容：

```bash
pnpm start -- "hi"
```

11. 等价于 `--prompt "hi" --exit-on-done` ✓

记录哪几条手工 smoke 通过/未通过。如果有失败，定位问题修复并加测试。

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(tui): single App + theme + flat transcript model (Phase 14a)

- modes/{ReplMode,OneShotMode}.tsx 删除，业务逻辑全部迁入 App.tsx
- AppInner 一个组件支持 REPL 模式 + initial_prompt 模式 + --exit-on-done
- 位置参数 "oh-tui hi" 自动等价 "--prompt hi --exit-on-done"（向后兼容）
- ThemeProvider 注入 --theme（default/dark/minimal）
- ConversationView 用顶层 tool/tool_result + invocationId 配对替代嵌套 toolCalls
- Welcome / Footer 新增；StatusBar 改 │ 分隔 + 可选 tokens 段
- 旧组件 TranscriptItemView / ToolCallView / StreamingMessage 删除
- useTranscript 兼容垫片同步移除

手工 smoke 通过：[填入 1-11 中实际通过的项]
EOF
)"
```

---

### Task 11: v0.4.0 release

**Files:**
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Bump version**

打开 `package.json`，把 `"version": "0.3.3"` 改为 `"version": "0.4.0"`。

- [ ] **Step 2: Update `README.md`**

读现有 README 顶部，把 `What's new` 部分（如果存在）的最上方插入新版本块。如果不存在该部分，在 README 顶部 install/usage 之前插入：

```markdown
## What's new in v0.4.0 — OpenHarness 1:1 visual refresh (Phase 14a)

- 单一 `App.tsx`：`modes/ReplMode` 与 `OneShotMode` 二分消解，`oh-tui "hi"` 与 `--prompt "hi" --exit-on-done` 等价
- 主题系统：`--theme default | dark | minimal`（`/theme` 命令在 14b 落地）
- WelcomeBanner ASCII LOGO + 命令提示
- TranscriptItem 扁平化：tool / tool_result 升为顶层行，由 `invocationId` 显式配对
- ConversationView 用 `<Static>` 切分已完成项 + 动态层，性能更稳
- StatusBar 重做：`─` 分隔线 + `│` 分隔段；按数据存在性动态展段；新增 tokens 段
- Footer 单行环境信息
- 新增 ToolCallDisplay 替代 ToolCallView，配对 tool + tool_result

### 不在本次范围（明确预告）

- CommandPicker / slash 命令补全 → **Phase 14b**
- `/theme` 命令、Tab 补全、数字键快选、Esc 双击清输入、Ctrl+C 单击 exit → **Phase 14b**
- assistant delta buffering、`useDeferredValue`、SidePanel → **Phase 14c**
```

如果 README 已经有 `## What's new in v0.x.x` 块，新版本块插入到第一个旧版本块之上（保持最新在前）。

- [ ] **Step 3: 全量质量门**

```bash
pnpm typecheck
pnpm test
pnpm lint
```

预期：全部 pass。

- [ ] **Step 4: Commit + tag**

```bash
git add package.json README.md
git commit -m "$(cat <<'EOF'
release: oh-tui v0.4.0 — OpenHarness 1:1 visual refresh (Phase 14a)

Phase 14a 落地：
- modes 二分消解为单一 App
- 主题系统（default / dark / minimal）
- WelcomeBanner ASCII LOGO
- TranscriptItem 扁平化 + tool/tool_result 顶层配对
- ConversationView + ToolCallDisplay 新组件
- StatusBar 重做 + Footer 新增

14b 预告：CommandPicker、Tab 补全、Esc 双击、/theme、Ctrl+C 行为对齐
14c 预告：delta buffering、useDeferredValue、SidePanel
EOF
)"

git tag -a v0.4.0 -m "v0.4.0 — Phase 14a OpenHarness 1:1 visual"
git push origin master
git push origin v0.4.0
```

---

## Self-Review

**Spec coverage** — 对照 spec 4 节：

| Spec 项 | 对应 task |
|---|---|
| 节 1 文件清单：modes/ 删除、App.tsx 重写、cli.tsx 改 | T10 |
| 节 1 cli.tsx 参数：--prompt / --exit-on-done / --theme | T10 |
| 节 2 TranscriptItem 新模型 | T1 |
| 节 2 useTranscript 新 API | T1 |
| 节 2 App.tsx 事件路由 | T10 |
| 节 2 ConversationView 分组渲染 | T6 |
| 节 2 `<Static>` 切分 | T6 |
| 节 2 replay.ts 适配 | T9 |
| 节 3.1 ThemeContext + builtinThemes | T2 |
| 节 3.2 WelcomeBanner | T4 |
| 节 3.3 StatusBar 重做（│ 分隔 + tokens 段） | T7 |
| 节 3.4 Footer | T8 |
| 节 3.5 ToolCallDisplay | T5 |
| 节 3.6 ConversationView 视觉总览（render 顺序）| T10 (在 App.tsx) |
| 节 4 useTranscript 测试 | T1 |
| 节 4 Spinner theme 断言 | T3 |
| 节 4 ConversationView 测试 | T6 |
| 节 4 StatusBar 测试 | T7 |
| 节 4 ThemeContext 测试 | T2 |
| 节 4 手工 smoke 10 条 | T10 |
| 节 4 release v0.4.0 + README + tag | T11 |
| 现有组件接入主题：Spinner / TodoPanel / MarkdownText | T3 |

**全覆盖。**

**Placeholder scan**：搜索 plan 全文：
- 无 "TBD" / "TODO" / "implement later"
- 无 "Add appropriate error handling"
- 无 "Write tests for the above"
- 无 "Similar to Task N"
- 每个代码步都给了完整代码
- 验证命令都给了预期输出

**Type consistency**：
- `TranscriptItem.role` 在 T1 定义为 `"system" | "user" | "assistant" | "tool" | "tool_result"`，T6 ConversationView 用同样值
- `useTranscript` 的 `appendTool(invocationId, toolName, toolInput)` 在 T1 定义，T10 App.tsx 用同样签名
- `appendToolResult(invocationId, text, isError)` 在 T1 定义，T10 App.tsx 同样
- `ConversationViewProps` 在 T6 定义为 `{ items, activeAssistantId, showWelcome, version, fullToolOutput }`，T10 App.tsx 调用一致
- `ToolCallDisplayProps` 在 T5 定义为 `{ tool, result, fullToolOutput }`，T6 ConversationView 调用一致
- `StatusBarProps` 在 T7 扩展（保留 telemetry，新加 tokens），T10 App.tsx 调用时 tokens 暂不传（保留 null/undefined），向后兼容
- `useTheme()` 返回 `{ theme, themeName, setThemeName }`，T2 定义，T3 / T4 / T5 / T6 / T7 各组件读 `theme.colors.*` / `theme.icons.*` 一致

**全一致。**

## Execution

按用户指示直接进入 superpowers:subagent-driven-development（multi-agent driven）。T1 是基础，必须先做；T2-T9 内部松散依赖（T3 依赖 T2 的 ThemeProvider；T5 依赖 T1 的 TranscriptItem；T6 依赖 T1+T4+T5；T9 依赖 T1）；T10 依赖 T1-T9 全部；T11 依赖 T10。
