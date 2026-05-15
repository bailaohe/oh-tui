# Phase 14b Implementation Plan — CommandPicker + 键位对齐 + /theme

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Ship oh-tui v0.5.0 — CommandPicker 补全菜单、Tab/数字键/Esc 双击键位、Ctrl+C 单击 exit（移除 double-tap）、`/theme` 命令。

**Architecture:** PromptInput 简化为 controlled 渲染组件（value/onChange/onSubmit prop-driven）；input/history/picker/themeModal 全部 state lift up 到 App.tsx；App.tsx 用单个集中 useInput 互斥处理所有键位（Ctrl+C → modal 数字键 → picker → Esc 双击 → ↑↓ history）。

**Tech Stack:** TS 5 strict + exactOptionalPropertyTypes、Ink 5、React 18、vitest + ink-testing-library + jsdom、pnpm。

**Spec:** `docs/superpowers/specs/2026-05-15-phase14b-command-picker-keybinds-design.md`

**Repo:** `/Users/baihe/Projects/study/oh-tui`（branch `master`，当前 v0.4.0）

---

## File map

| File | Action | Task |
|---|---|---|
| `src/components/CommandPicker.tsx` | Create | T1 |
| `tests/components/CommandPicker.test.tsx` | Create | T1 |
| `src/components/PromptInput.tsx` | Rewrite (controlled) | T2 |
| `tests/components/PromptInput.test.tsx` | Rewrite | T2 |
| `src/App.tsx` | Modify (lift state + useInput + /theme + picker) | T3 |
| `src/hooks/useKeybinds.ts` | Delete | T3 |
| `src/components/StatusBar.tsx` | Modify (drop exit hint state in caller side; cancelHint 简化) | T3 |
| `package.json` | Modify (0.5.0) | T4 |
| `README.md` | Modify (v0.5.0 changelog) | T4 |

---

### Task 1: CommandPicker 组件 + 测试

**Files:**
- Create: `src/components/CommandPicker.tsx`
- Create: `tests/components/CommandPicker.test.tsx`

- [ ] **Step 1: Create `src/components/CommandPicker.tsx`**

```typescript
/**
 * CommandPicker — floating slash-command suggestion menu rendered above the
 * prompt input. Driven entirely by props; App.tsx owns the hints + selected
 * index, this component is a pure view.
 *
 * Renders null when hints is empty so callers can mount unconditionally and
 * let the prop drive visibility.
 */

import type React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/ThemeContext.js";

export interface CommandPickerProps {
  hints: string[];
  selectedIndex: number;
}

export function CommandPicker({
  hints,
  selectedIndex,
}: CommandPickerProps): React.JSX.Element | null {
  const { theme } = useTheme();
  if (hints.length === 0) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.colors.primary}
      paddingX={1}
      marginBottom={0}
    >
      <Text dimColor bold> Commands</Text>
      {hints.map((hint, i) => {
        const isSelected = i === selectedIndex;
        return (
          <Box key={hint}>
            <Text color={isSelected ? theme.colors.primary : undefined} bold={isSelected}>
              {isSelected ? "❯ " : "  "}
              {hint}
            </Text>
            {isSelected && <Text dimColor> [enter]</Text>}
          </Box>
        );
      })}
      <Text dimColor> ↑↓ navigate  ⏎ select  esc dismiss</Text>
    </Box>
  );
}
```

- [ ] **Step 2: Create `tests/components/CommandPicker.test.tsx`**

```typescript
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { CommandPicker } from "../../src/components/CommandPicker.js";
import { ThemeProvider } from "../../src/theme/ThemeContext.js";

describe("CommandPicker", () => {
  it("renders nothing when hints is empty", () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <CommandPicker hints={[]} selectedIndex={0} />
      </ThemeProvider>,
    );
    expect((lastFrame() ?? "").trim()).toBe("");
  });

  it("renders all hints with selected marker on the chosen one", () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <CommandPicker hints={["/sessions", "/tools", "/theme"]} selectedIndex={1} />
      </ThemeProvider>,
    );
    const f = lastFrame() ?? "";
    expect(f).toContain("/sessions");
    expect(f).toContain("/tools");
    expect(f).toContain("/theme");
    // 选中项是第 2 项（idx 1）→ /tools 前应有 ❯
    expect(f).toMatch(/❯\s+\/tools/);
    // 未选中项前是空格
    expect(f).toMatch(/\s+\/sessions/);
  });

  it("shows [enter] hint next to the selected item", () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <CommandPicker hints={["/exit"]} selectedIndex={0} />
      </ThemeProvider>,
    );
    expect(lastFrame() ?? "").toContain("[enter]");
  });

  it("shows the bottom navigation help text", () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <CommandPicker hints={["/help"]} selectedIndex={0} />
      </ThemeProvider>,
    );
    const f = lastFrame() ?? "";
    expect(f).toContain("navigate");
    expect(f).toContain("select");
    expect(f).toContain("dismiss");
  });
});
```

- [ ] **Step 3: 测试 + typecheck**

```bash
cd /Users/baihe/Projects/study/oh-tui && pnpm test CommandPicker && pnpm typecheck
```

预期：4/4 pass，typecheck 0 errors。

- [ ] **Step 4: Commit**

```bash
cd /Users/baihe/Projects/study/oh-tui && git add src/components/CommandPicker.tsx tests/components/CommandPicker.test.tsx
git commit -m "feat(tui): CommandPicker — floating slash-command menu

Pure view component. App.tsx (T3) drives hints + selectedIndex props.
hints 空时返回 null；选中项前缀 ❯ + 主题色 + [enter] 提示；
底栏帮助行 ↑↓ navigate ⏎ select esc dismiss。"
```

---

### Task 2: PromptInput 重构为 controlled 组件 + 测试重写

**Files:**
- Rewrite: `src/components/PromptInput.tsx`
- Rewrite: `tests/components/PromptInput.test.tsx`

- [ ] **Step 1: Rewrite `src/components/PromptInput.tsx`**

完全替换为：

```typescript
/**
 * PromptInput — controlled single-line input.
 *
 * After Phase 14b, App.tsx owns all editor state (value, history, picker,
 * Esc-double-tap) and PromptInput is a pure render component that wraps
 * ink-text-input. ↑/↓ history navigation lives in App.tsx's central
 * useInput handler.
 *
 * When `suppressSubmit` is true, Enter is swallowed — App.tsx is handling
 * Enter for picker selection instead.
 */

import type React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { useTheme } from "../theme/ThemeContext.js";

export interface PromptInputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  placeholder?: string;
  suppressSubmit?: boolean;
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  suppressSubmit = false,
}: PromptInputProps): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <Box>
      <Text color={theme.colors.primary}>oh&gt; </Text>
      <TextInput
        value={value}
        onChange={onChange}
        onSubmit={suppressSubmit ? () => {} : onSubmit}
        {...(placeholder !== undefined ? { placeholder } : {})}
      />
    </Box>
  );
}
```

- [ ] **Step 2: Rewrite `tests/components/PromptInput.test.tsx`**

完全替换：

```typescript
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { PromptInput } from "../../src/components/PromptInput.js";
import { ThemeProvider } from "../../src/theme/ThemeContext.js";

describe("PromptInput (controlled)", () => {
  it("renders the cyan oh> prefix and the current value", () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <PromptInput value="hello" onChange={() => {}} onSubmit={() => {}} />
      </ThemeProvider>,
    );
    const f = lastFrame() ?? "";
    expect(f).toContain("oh>");
    expect(f).toContain("hello");
  });

  it("invokes onChange when stdin types a character", () => {
    const observed: string[] = [];
    const { stdin } = render(
      <ThemeProvider>
        <PromptInput
          value=""
          onChange={(v) => observed.push(v)}
          onSubmit={() => {}}
        />
      </ThemeProvider>,
    );
    stdin.write("a");
    expect(observed).toContain("a");
  });

  it("invokes onSubmit on Enter when suppressSubmit is false", () => {
    let submitted: string | null = null;
    const { stdin } = render(
      <ThemeProvider>
        <PromptInput
          value="x"
          onChange={() => {}}
          onSubmit={(v) => {
            submitted = v;
          }}
        />
      </ThemeProvider>,
    );
    stdin.write("\r"); // CR == Enter for ink-text-input
    expect(submitted).toBe("x");
  });

  it("swallows Enter when suppressSubmit is true", () => {
    let submitted: string | null = null;
    const { stdin } = render(
      <ThemeProvider>
        <PromptInput
          value="x"
          onChange={() => {}}
          onSubmit={(v) => {
            submitted = v;
          }}
          suppressSubmit={true}
        />
      </ThemeProvider>,
    );
    stdin.write("\r");
    expect(submitted).toBeNull();
  });
});
```

- [ ] **Step 3: 测试 + typecheck**

```bash
cd /Users/baihe/Projects/study/oh-tui && pnpm test PromptInput && pnpm typecheck
```

预期：4/4 pass。**注意**：typecheck **会失败**——App.tsx 仍在用旧 API（`<PromptInput history={history} onSubmit={submit} />`）。预期失败文件：只有 `src/App.tsx`（约 1-2 个错误）。T3 修复。

- [ ] **Step 4: Commit**

```bash
cd /Users/baihe/Projects/study/oh-tui && git add src/components/PromptInput.tsx tests/components/PromptInput.test.tsx
git commit -m "refactor(tui): PromptInput → controlled component (state lift up)

value/onChange/onSubmit 由 App.tsx 传入。删除内部 value/historyIdx/draft
state；↑↓ history 处理逻辑迁到 App.tsx 在 T3 实装。suppressSubmit prop
让 App.tsx 在 picker active 时夺过 Enter。

typecheck 在 T3 前会有 App.tsx 旧调用失败，T3 一并修复。"
```

---

### Task 3: App.tsx 重构（集中键位 + picker + /theme）+ 删 useKeybinds + StatusBar 简化

**Files:**
- Modify: `src/App.tsx`
- Delete: `src/hooks/useKeybinds.ts`
- Modify: `src/components/StatusBar.tsx`（仅 cancelHint 文档说明）

这是 14b 最大的一步。**分两个 commit**：先**集中键位 + picker**（不含 /theme），再 **+ /theme**。

#### Step 1: 修改 App.tsx — imports + state + useInput

打开 `src/App.tsx`。逐项改：

**1.1 imports 区**

删除：
```typescript
import { useCancelOrExit } from "./hooks/useKeybinds.js";
```

新增（与现有 imports 合并）：
```typescript
import { useTheme } from "./theme/ThemeContext.js";
import { CommandPicker } from "./components/CommandPicker.js";
import { useInput } from "ink";  // 若已有则跳过
```

注意 `useInput` 可能已经通过其他 import 间接引入，但 App.tsx 自己**未直接 import** ink 的 useInput。检查 ink 的 import 行，如果只有 `Box, Text, useApp`，加上 `useInput`：

```typescript
import { Box, Text, useApp, useInput } from "ink";
```

**1.2 删除 useCancelOrExit 调用**

找到这块：
```typescript
useCancelOrExit({
  getInflight: () => handleRef.current,
  onExit: () => app.exit(),
  onHint: setExitHintVisible,
});
```

**完全删除**。Ctrl+C 处理在新 useInput 内联实现。

**1.3 删除 exitHintVisible state**

找到 `const [exitHintVisible, setExitHintVisible] = useState(false);` —— 删除整行。

cancelHint 计算（位于 render 块之前）从：
```typescript
const cancelHint: string | null = exitHintVisible
  ? "press Ctrl+C again to exit"
  : handleRef.current !== null
    ? "Ctrl+C to cancel"
    : null;
```
改为：
```typescript
const cancelHint: string | null =
  handleRef.current !== null ? "Ctrl+C to cancel" : null;
```

**1.4 在 AppInner 顶部，紧挨 transcript 声明之后加新 state**

```typescript
const [input, setInput] = useState("");
const [pickerIndex, setPickerIndex] = useState(0);
const [historyIdx, setHistoryIdx] = useState<number>(0);
const [draft, setDraft] = useState("");
const [lastEscapeAt, setLastEscapeAt] = useState(0);
const [themeModal, setThemeModal] = useState<SelectOption[] | null>(null);
const { setThemeName } = useTheme();
```

将旧的 `const [history, setHistory] = useState<string[]>([]);` 保留——history 数组仍由 App 持有。

**1.5 派生 commandHints + showPicker**

紧接其他 state 之后加：

```typescript
const COMMANDS: string[] = [
  "/help",
  "/exit",
  "/quit",
  "/sessions",
  "/tools",
  "/provider",
  "/model",
  "/profile",
  "/theme",
  "/resume",
];

const commandHints = (() => {
  const v = input.trim();
  if (!v.startsWith("/")) return [] as string[];
  return COMMANDS.filter((c) => c.startsWith(v)).slice(0, 10);
})();

const showPicker =
  commandHints.length > 0 &&
  !waitingForFirstToken &&
  permission === null &&
  sessionsModal === null &&
  providerModal === null &&
  modelModal === null &&
  profileModal === null &&
  themeModal === null;

// reset picker index when hints change
useEffect(() => {
  setPickerIndex(0);
}, [commandHints.length, input]);
```

**1.6 新加 useInput 集中处理**

在 telemetry useEffect **之后** 加：

```typescript
useInput((inputStr, key) => {
  // 优先级 1：Ctrl+C
  if (key.ctrl && inputStr === "c") {
    if (handleRef.current !== null) {
      handleRef.current.cancel().catch(() => {});
      return;
    }
    app.exit();
    return;
  }

  // 优先级 2：数字键快选（只在 SelectModal 类 modal active）
  // permission modal 有自己的 useInput，不在此处理
  const activeModal: SelectOption[] | null =
    sessionsModal !== null
      ? sessionsModal.options
      : providerModal !== null
        ? providerModal
        : modelModal !== null
          ? modelModal
          : profileModal !== null
            ? profileModal
            : themeModal;

  if (activeModal !== null && /^[1-9]$/.test(inputStr)) {
    const idx = parseInt(inputStr, 10) - 1;
    const target = activeModal[idx];
    if (target !== undefined) {
      // dispatch via the same handler used by Enter — find it by inspecting
      // which modal is active. Simpler: emulate clicking the option.
      if (sessionsModal !== null) {
        setSessionsModal(null);
        submit(`/resume ${target.value}`);
      } else if (providerModal !== null) {
        handleSwitchProvider(target.value);
      } else if (modelModal !== null) {
        handleSwitchModel(target.value);
      } else if (profileModal !== null) {
        handleSwitchProfile(target.value);
      } else if (themeModal !== null) {
        setThemeName(target.value);
        setThemeModal(null);
        transcript.appendSystem("info", `theme → ${target.value}`);
      }
    }
    return;
  }

  // 优先级 3：CommandPicker active
  if (showPicker) {
    if (key.upArrow) {
      setPickerIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setPickerIndex((i) => Math.min(commandHints.length - 1, i + 1));
      return;
    }
    if (key.return) {
      const selected = commandHints[pickerIndex];
      if (selected !== undefined) {
        setInput("");
        submit(selected);
      }
      return;
    }
    if (key.tab) {
      const selected = commandHints[pickerIndex];
      if (selected !== undefined) {
        setInput(selected);
      }
      return;
    }
    if (key.escape) {
      setInput("");
      return;
    }
    // fall through: 普通字符键透传给 ink-text-input
  }

  // 优先级 4：双击 Esc 清空
  if (key.escape && !showPicker) {
    const now = Date.now();
    if (input.length > 0 && now - lastEscapeAt < 500) {
      setInput("");
      setLastEscapeAt(0);
      return;
    }
    setLastEscapeAt(now);
    return;
  }

  // 优先级 5：↑↓ history（非 picker，非 busy）
  if (!showPicker && handleRef.current === null) {
    if (key.upArrow) {
      if (history.length === 0) return;
      const newIdx = Math.max(0, historyIdx - 1);
      if (newIdx === historyIdx && historyIdx !== history.length) return;
      // 当 historyIdx === history.length（draft 槽），首次 ↑ 时保存 draft
      if (historyIdx === history.length) {
        setDraft(input);
        setHistoryIdx(Math.max(0, history.length - 1));
        setInput(history[history.length - 1] ?? "");
        return;
      }
      setHistoryIdx(newIdx);
      setInput(history[newIdx] ?? "");
      return;
    }
    if (key.downArrow) {
      if (historyIdx >= history.length) return;
      const newIdx = historyIdx + 1;
      setHistoryIdx(newIdx);
      setInput(newIdx === history.length ? draft : (history[newIdx] ?? ""));
      return;
    }
  }
});
```

**关键注释**：

- `historyIdx === history.length` 表示"在 draft 槽"（没在 history 内）
- 首次 ↑：先存 draft，跳到 history 最末项
- ↓ 离开 history 末端：恢复 draft

**1.7 commandPicker 渲染**

在 `<PermissionDialog ... />` 之后、第一个 SelectModal 之前加（picker 与 modal 互斥，showPicker 已经包含 modal 检查）：

```typescript
{showPicker && <CommandPicker hints={commandHints} selectedIndex={pickerIndex} />}
```

**1.8 PromptInput 调用改 controlled API**

旧：
```typescript
<PromptInput history={history} onSubmit={submit} />
```

新：
```typescript
<PromptInput
  value={input}
  onChange={(v) => {
    setInput(v);
    // 任何直接 onChange 编辑都会把 historyIdx 拉回 draft 槽
    if (historyIdx !== history.length) setHistoryIdx(history.length);
  }}
  onSubmit={(v) => {
    setHistory((h) => [...h, v]);
    setHistoryIdx(history.length + 1); // 跳到新 draft 槽
    setDraft("");
    setInput("");
    submit(v);
  }}
  suppressSubmit={showPicker}
/>
```

**1.9 themeModal 渲染**

在最后一个 SelectModal（profileModal）的渲染之后加：

```typescript
{permission === null &&
  sessionsModal === null &&
  providerModal === null &&
  modelModal === null &&
  profileModal === null &&
  themeModal !== null && (
    <SelectModal
      title="switch theme"
      options={themeModal}
      onSelect={(name) => {
        setThemeName(name);
        setThemeModal(null);
        transcript.appendSystem("info", `theme → ${name}`);
      }}
      onCancel={() => setThemeModal(null)}
    />
  )}
```

**1.10 submit() 内加 /theme 分支**

在 `if (prompt === "/profile") { ... }` 之后、`if (prompt.trim() === "") return;` 之前加：

```typescript
if (prompt === "/theme") {
  setThemeModal([
    { value: "default", label: "default" },
    { value: "dark", label: "dark" },
    { value: "minimal", label: "minimal" },
  ]);
  return;
}
```

#### Step 2: 删除 useKeybinds.ts

```bash
cd /Users/baihe/Projects/study/oh-tui && git rm src/hooks/useKeybinds.ts
```

#### Step 3: typecheck + test

```bash
cd /Users/baihe/Projects/study/oh-tui && pnpm typecheck
```

预期：0 errors。

```bash
cd /Users/baihe/Projects/study/oh-tui && pnpm test
```

预期：所有现有测试 pass（CommandPicker 4 + PromptInput 4 + 之前 46 = 54 左右）。

#### Step 4: Commit

```bash
cd /Users/baihe/Projects/study/oh-tui && git add -A
git commit -m "$(cat <<'EOF'
refactor(tui): centralize keybinds in App.tsx + CommandPicker integration

- input/history/picker/themeModal state lift up to App.tsx
- 单个 useInput 互斥处理：Ctrl+C 单击 / 数字键快选 / picker (↑↓/Tab/Enter/Esc) /
  Esc 双击清空 / ↑↓ history navigation（draft 保护）
- StatusBar cancelHint 简化：只显示 "Ctrl+C to cancel"（busy 时），移除
  "press Ctrl+C again to exit"（v0.2 double-tap exit 行为）
- 删除 src/hooks/useKeybinds.ts（无调用方）
- PromptInput 用 controlled API（value/onChange/onSubmit/suppressSubmit）

BREAKING UX: Ctrl+C 单击直接 exit（idle 时），1:1 对齐 OpenHarness。
EOF
)"
```

#### Step 5: 加 /theme 命令（第二个 commit）

如果 Step 1 已包含 /theme 改动（1.7/1.8/1.9/1.10），则 Step 4 commit 一起 cover。**实际操作**：Step 1 的 1.6/1.7/1.8/1.9/1.10 已包含 themeModal 渲染和 submit() 分支，所以**Step 4 单个 commit 即可**。Step 5 跳过。

---

### Task 4: v0.5.0 release

**Files:**
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Bump version**

`package.json` 的 `"version": "0.4.0"` → `"version": "0.5.0"`。

- [ ] **Step 2: 更新 README.md**

在 v0.4.0 changelog 块（即 `## v0.4.0 — OpenHarness 1:1 visual refresh (Phase 14a)`）**之上**插入：

```markdown
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

### BREAKING UX

`Ctrl+C` 在 idle 时**单击退出**（不再有 "press Ctrl+C again to exit" 二段保护）。习惯 v0.4 行为的用户在 14d 评估期可申请 `OH_TUI_REQUIRE_DOUBLE_EXIT=1` 环境变量恢复双击模式。

```

- [ ] **Step 3: 全量质量门**

```bash
cd /Users/baihe/Projects/study/oh-tui && pnpm typecheck && pnpm test && pnpm lint
```

预期：typecheck 0、test 全 pass、lint clean。

- [ ] **Step 4: Commit + tag**

```bash
cd /Users/baihe/Projects/study/oh-tui && git add package.json README.md
git commit -m "$(cat <<'EOF'
release: oh-tui v0.5.0 — CommandPicker + 键位对齐 (Phase 14b)

- CommandPicker / slash 命令补全 / Tab 补全
- /theme 命令切换主题（default/dark/minimal）
- 数字键 1-9 快选 SelectModal 项
- Esc 双击 500ms 清空输入
- Ctrl+C 单击 exit (BREAKING UX, 1:1 OpenHarness)
- PromptInput 重构为 controlled 组件
- App.tsx 集中键位处理；删除 useKeybinds.ts

14c 预告：delta buffering、useDeferredValue、SidePanel、TodoPanel markdown
EOF
)"
git tag -a v0.5.0 -m "v0.5.0 — Phase 14b CommandPicker + 键位对齐"
```

不要 push（由 controller 决定）。

---

## Self-Review

**Spec coverage**：

| Spec 项 | Task |
|---|---|
| 节 1 CommandPicker 组件 | T1 |
| 节 1 CommandPicker 测试 4 用例 | T1 |
| 节 2 集中 useInput 处理 | T3 |
| 节 2 Ctrl+C 单击 + cancel | T3 |
| 节 2 数字键快选 | T3 |
| 节 2 picker ↑↓/Tab/Enter/Esc | T3 |
| 节 2 Esc 双击清空 | T3 |
| 节 2 ↑↓ history（draft 保护） | T3 |
| 节 2 删除 useKeybinds.ts | T3 |
| 节 2 StatusBar cancelHint 简化 | T3 |
| 节 3 /theme 命令 + themeModal | T3 |
| 节 4 PromptInput controlled API | T2 |
| 节 4 PromptInput 测试重写 | T2 |
| 节 5 手工 smoke | T4 release commit 引用 |
| 节 6 v0.5.0 release | T4 |

全覆盖。

**Placeholder scan**：搜全文，无 TBD/TODO/"add appropriate"/"similar to Task N"。每个代码步给完整代码。

**Type consistency**：
- `CommandPickerProps { hints: string[]; selectedIndex: number }` T1 定义、T3 调用一致
- `PromptInputProps { value, onChange, onSubmit, placeholder?, suppressSubmit? }` T2 定义、T3 调用一致
- `themeModal: SelectOption[] | null` T3 各处一致
- `setThemeName(name: string)` 来自 useTheme()，T3 调用一致

## Execution

按 Subagent-Driven。T1 → T2 → T3 → T4 串行；T3 内部"集中键位 + /theme" 可一次 commit 完成。
