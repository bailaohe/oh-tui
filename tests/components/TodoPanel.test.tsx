import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { TodoPanel, parseTodos } from "../../src/components/TodoPanel.js";

describe("TodoPanel", () => {
  it("renders todos with status icons", () => {
    const { lastFrame } = render(
      <TodoPanel
        todos={[
          { content: "step one", status: "completed" },
          { content: "step two", status: "in_progress" },
          { content: "step three", status: "pending" },
        ]}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("plan");
    expect(out).toContain("step one");
    expect(out).toContain("step two");
    expect(out).toContain("step three");
  });
});

describe("parseTodos", () => {
  it("extracts valid todos", () => {
    const todos = parseTodos({
      todos: [
        { content: "do thing", status: "pending" },
        { content: "done thing", status: "completed" },
      ],
    });
    expect(todos).toHaveLength(2);
    expect(todos?.[0]).toEqual({ content: "do thing", status: "pending" });
    expect(todos?.[1]).toEqual({ content: "done thing", status: "completed" });
  });

  it("rejects malformed shapes", () => {
    expect(parseTodos(null)).toBeNull();
    expect(parseTodos({})).toBeNull();
    expect(parseTodos({ todos: "not an array" })).toBeNull();
    expect(parseTodos({ todos: [{ content: 1 }] })).toBeNull();
    expect(
      parseTodos({ todos: [{ content: "x", status: "bogus" }] }),
    ).toBeNull();
  });
});
