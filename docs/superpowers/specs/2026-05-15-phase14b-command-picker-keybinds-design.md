# Phase 14b — CommandPicker + 键位对齐 + /theme 命令

## Goal

把 oh-tui 的输入交互 1:1 对齐 OpenHarness 的键位模型。具体：

- **CommandPicker**：输入以 `/` 开头时浮出命令补全菜单
- **Tab 补全**：picker active 时 Tab 补全到选中命令（不带尾空格）
- **数字键快选**：SelectModal active 时按 1-9 直接选第 N 项
- **Esc 双击清空**：500ms 内连按两次 Esc 清空当前输入
- **Ctrl+C 单击对齐**：busy=interrupt / idle=exit，**移除** v0.2 的 double-tap exit 机制
- **`/theme` 命令**：通过 SelectModal 切换主题

发布版本：v0.4.0 → **v0.5.0**。

## Scope

### 不做

- shift+enter 多行输入（ink-text-input 限制）→ 14d 评估
- 自定义键位映射 → 永久砍
- 命令历史的全文本搜索 → 永久砍
- "empty Tab opens permissions picker"（OpenHarness 行为）→ 永久砍（permission_mode 不存在）

### 已在 14a 永久砍清单

- SwarmPanel、permission_mode、vim/voice、effort/passes/turns、shift+enter

## Architecture

### 键位处理集中化

**当前（14a 后）**：键位散布在 PromptInput（↑↓ history）和 App.tsx（Ctrl+C 通过 useCancelOrExit hook）两处。

**14b 重构**：1:1 OpenHarness 模式——所有键位集中在 App.tsx 的一个 `useInput` 回调中互斥处理，PromptInput 退化为纯渲染组件，value 状态 lift up 到 App。

集中处理的优点：
- 互斥逻辑显式：`if (picker active) ... else if (modal active) ... else if (busy) ...`
- 修复 ink-text-input 与外部 useInput 互争 ↑↓ 的语义
- 跟 OpenHarness 完全同构，便于未来对齐

### slash 命令模型

App.tsx 维护一个**命令清单**（hardcoded，与 `submit()` 内的 if 链一致）：

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
  "/theme",          // 14b 新增
  "/resume",         // 接 <id> 参数
];
```

`commandHints` 派生自 input：

```typescript
const commandHints = useMemo(() => {
  const v = input.trim();
  if (!v.startsWith("/")) return [];
  return COMMANDS.filter((c) => c.startsWith(v)).slice(0, 10);
}, [input]);
const showPicker = commandHints.length > 0 && !busy && !permission && !sessionsModal && !providerModal && !modelModal && !profileModal && !themeModal;
```

### Modal 互斥优先级（14b 重整）

OpenHarness 风格的精确互斥层级（最高在前）：

1. `permission` modal（兜底，最高）
2. `sessionsModal`
3. `providerModal` / `modelModal` / `profileModal` / `themeModal`（任意一个，互斥）
4. CommandPicker（与 modal 互斥）
5. 普通 prompt 输入

14b 同时引入第 4 层（picker）和 `themeModal`（与 provider 同级）。

## 节 1 — CommandPicker 组件

### 视觉（OpenHarness 复刻）

```
╭─ Commands ──────────────╮
│ ❯ /sessions   [enter]    │
│   /tools                 │
│   /theme                 │
│ ↑↓ navigate ⏎ select esc dismiss │
╰──────────────────────────╯
```

### API

```typescript
export interface CommandPickerProps {
  hints: string[];
  selectedIndex: number;
}

export function CommandPicker({ hints, selectedIndex }: CommandPickerProps): React.JSX.Element | null;
```

- `hints` 空时返回 null
- 选中项前缀 `❯ ` + 主题 primary 色；其他 `  ` 缩进
- 选中项后跟 ` [enter]` 暗色提示
- 底部一行帮助：`↑↓ navigate ⏎ select esc dismiss`
- 圆角边框 `borderStyle="round"`，主题 primary 色

## 节 2 — 键位重设

### App.tsx 内统一 useInput 处理

替换 useCancelOrExit hook 的调用，改为内联 `useInput`：

```typescript
useInput((input, key) => {
  // 优先级最高：Ctrl+C
  if (key.ctrl && input === "c") {
    if (handleRef.current !== null) {
      // busy → cancel
      handleRef.current.cancel().catch(() => {});
      return;
    }
    // idle → exit（1:1 OpenHarness：单击，无 double-tap）
    app.exit();
    return;
  }

  // 优先级 2：在 modal 内的数字键快选
  const activeModal = getActiveModal();   // 返回当前活跃 modal 引用或 null
  if (activeModal !== null && /^[1-9]$/.test(inputStr)) {
    const idx = parseInt(inputStr, 10) - 1;
    if (idx < activeModal.options.length) {
      activeModal.onSelect(activeModal.options[idx].value);
    }
    return;
  }
  // (modal 的 ↑↓ + Enter + Esc 由 SelectModal 内部 useInput 处理，无需在此重复)

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
        // 补全到 input（无 trailing space，让用户决定是否加参数）
        setInput(selected);
      }
      return;
    }
    if (key.escape) {
      setInput("");
      return;
    }
    // 字符键透传给 ink-text-input
  }

  // 优先级 4：双击 Esc 清空（idle，且非 picker）
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

  // 优先级 5：↑↓ history（非 picker、非 busy）
  if (!showPicker && !busy) {
    if (key.upArrow) {
      if (history.length === 0) return;
      const newIdx = Math.max(0, historyIdx - 1);
      if (newIdx === historyIdx) return;
      if (historyIdx === history.length) setDraft(input);
      setHistoryIdx(newIdx);
      setInput(history[newIdx] ?? "");
      return;
    }
    if (key.downArrow) {
      if (historyIdx === history.length) return;
      const newIdx = historyIdx + 1;
      setHistoryIdx(newIdx);
      setInput(newIdx === history.length ? draft : (history[newIdx] ?? ""));
      return;
    }
  }
});
```

注意：

- `getActiveModal()` 返回顺序：sessions → provider → model → profile → theme。返回最先非 null。**permission modal** 自己有 useInput 处理 y/n，不走数字键路径。
- 数字键流不消费输入：选中后 `onSelect` 关闭 modal，而 input 字符已经被消费但 input 当时是空的（modal 期 PromptInput suppressed）。
- `lastEscapeAt` 状态：旧的 v0.3 没有这个，14b 新增。
- ↑↓ history 逻辑从 PromptInput 搬到 App.tsx。PromptInput 不再持有 history 状态。

### useKeybinds.ts 清理

- 删除 `useCancelOrExit` —— Ctrl+C 单击 + cancel 逻辑直接在 App 内联
- 保留 `useCancelBinding` —— 暂未删除，可能 14d/未来重用；但**没有调用方**了，标记 `/** @deprecated 14b: kept for future external callers; remove if unused at 14d */`
- 实际上**删除** `useCancelBinding`，因为 OneShotMode 已不存在；唯一调用方消失

文件最终内容：保留接口/文档头，但函数全删 → **直接删除整个文件**。imports 在 App.tsx 同步移除。

### StatusBar cancelHint 简化

`cancelHint` 含义变化：
- 旧（14a）：`"press Ctrl+C again to exit"` / `"Ctrl+C to cancel"` / null
- 新（14b）：`"Ctrl+C to cancel"`（busy 时）/ null

代码改动：删除 `exitHintVisible` state，cancelHint 计算从二段变一段。

## 节 3 — /theme 命令

### App.tsx 改动

在 `submit()` 内的 slash 命令处理链中加：

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

`themeModal` 是新的 SelectModal 持有者；选中后调用 `useTheme()` 的 `setThemeName(newTheme)` 并关闭 modal。

`themeModal` state：

```typescript
const [themeModal, setThemeModal] = useState<SelectOption[] | null>(null);
```

Render 块加入新分支（与其他 modal 互斥）：

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

### setThemeName 来源

`useTheme()` 当前在 AppInner 内会拿到 ThemeProvider context 的 setThemeName。AppInner 需要 import + 调用 useTheme：

```typescript
const { setThemeName } = useTheme();
```

注意：AppInner 是 ThemeProvider 的子组件（App 包裹了 ThemeProvider），所以 useTheme 在 AppInner 内可用。

## 节 4 — PromptInput 重构（lift state）

### 现状

`PromptInput` 自己持有 `value` / `setValue` / `historyIdx` / `draft` state，自己处理 ↑↓。

### 14b 改动

- `value` / `setValue` 由 App 通过 props 传入
- ↑↓ history 移到 App
- 文件简化为纯渲染组件

新 API：

```typescript
export interface PromptInputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  placeholder?: string;
  /** When true, Enter is swallowed (used when CommandPicker is up — App handles Enter for picker selection). */
  suppressSubmit?: boolean;
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  suppressSubmit = false,
}: PromptInputProps): React.JSX.Element {
  return (
    <Box>
      <Text color="cyan">oh&gt; </Text>
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

App.tsx 拥有的新 state：

```typescript
const [input, setInput] = useState("");
const [pickerIndex, setPickerIndex] = useState(0);
const [historyIdx, setHistoryIdx] = useState(history.length);
const [draft, setDraft] = useState("");
const [lastEscapeAt, setLastEscapeAt] = useState(0);
const [themeModal, setThemeModal] = useState<SelectOption[] | null>(null);
```

`submit()` 函数签名不变（接收 prompt 字符串）。每次调用 `submit(...)` 前 App 自己清空 `input`。

### draft 状态保护

入 history 时（首次 ↑），把当前 `input` 存到 `draft`；出 history 末端（最后一次 ↓）时把 `draft` 恢复回 `input`。语义跟旧 PromptInput 一致。

### pickerIndex 重置

`commandHints` 变化时（输入变化）重置 pickerIndex 到 0：

```typescript
useEffect(() => {
  setPickerIndex(0);
}, [commandHints.length, input]);
```

## 节 5 — 测试

### 新增 / 改动

| 测试 | 状态 |
|---|---|
| `tests/components/CommandPicker.test.tsx` | **新建** — 3 用例：(a) hints 空 → 渲染 null；(b) hints 非空 → 列表 + 选中态；(c) 选中项有 `[enter]` 提示 |
| `tests/components/PromptInput.test.tsx` | **重写** — 简化为 controlled 模式的 prop 测试（value / onChange / onSubmit）；删除旧 history 测试 |
| `tests/hooks/useKeybinds.test.ts` | **删除**（文件不存在；若存在，删除）|
| App.tsx 集成键位测试 | **不做** — Ink 集成测试复杂，手工 smoke 覆盖 |

### 手工 smoke（v0.5.0 release commit 引用）

`pnpm start`：

1. 输入 `/` → CommandPicker 浮出，10 项内全显示
2. 输入 `/se` → 过滤到 `/sessions`、`/sessions` 高亮
3. ↑↓ 在 picker 内移动选中态
4. Tab 在 picker → 补全选中项到 input
5. Enter 在 picker → 提交选中项（不论 input 当前是什么）
6. Esc 在 picker → 清空 input
7. 普通输入下 ↑↓ 走 history（draft 保护）
8. 输入非空时 Esc 双击 500ms 内清空
9. `/theme` 触发 SelectModal，选 `dark` → 配色立刻变蓝紫，transcript 出现 `theme → dark`
10. modal 内数字 1/2/3 直接快选
11. Ctrl+C busy → cancel；Ctrl+C idle → exit（**不再有 "press again to exit" 提示**）

## 节 6 — Release

- `package.json`: `0.4.0` → **`0.5.0`**
- `README.md`：在 v0.4.0 块之上插入 v0.5.0 changelog
- `git tag v0.5.0`

Changelog 要点：
- CommandPicker / `/` 补全
- Tab 补全 / 数字键快选 / Esc 双击 / ↑↓ history
- Ctrl+C 单击 exit（**行为变更**，标注 BREAKING UX）
- `/theme` 切换命令
- PromptInput 重构（API breaking but internal only）

## 风险

| 风险 | 缓解 |
|---|---|
| 集中 useInput 与 ink-text-input 抢键位 | 集中在 App.tsx，picker active 时 PromptInput 设 `suppressSubmit`；Ink useInput 默认优先 child 之前触发 |
| Ctrl+C 单击 exit 易误触 | 1:1 OpenHarness 决定；用户偏好不一致可在 14d 加 OH_TUI_REQUIRE_DOUBLE_EXIT 环境变量 |
| ↑↓ history lift up 破坏现有 PromptInput 测试 | 测试同步重写为 controlled prop 模式 |
| useTheme 的 setThemeName 在 AppInner 调用 | AppInner 是 ThemeProvider 子；先 import + hook 调用即可 |
| draft 状态保护 lift up 后语义偏差 | 节 2 已明确："首次入 history 存 draft；最后出 history 末端恢复 draft" |

## 范围外（明确）

- assistant delta buffering / useDeferredValue → **14c**
- SidePanel → **14c**
- TodoPanel markdown 数据源 → **14c**
- shift+enter 多行 → 14d 评估
