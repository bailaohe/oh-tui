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
