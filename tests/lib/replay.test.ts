import { describe, it, expect } from "vitest";
import { messagesToTranscript } from "../../src/lib/replay.js";

describe("messagesToTranscript", () => {
  it("converts user + assistant text messages to transcript items", () => {
    const items = messagesToTranscript([
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "user", text: "hi" });
    expect(items[1]).toMatchObject({
      kind: "assistant",
      text: "hello",
      done: true,
    });
  });

  it("summarizes tool_call blocks as completed tool calls", () => {
    const items = messagesToTranscript([
      {
        role: "assistant",
        content: [
          { type: "text", text: "let me check" },
          {
            type: "tool_call",
            invocation_id: "inv-1",
            name: "file_read",
            args: { path: "/x" },
          },
        ],
      },
    ]);
    expect(items).toHaveLength(1);
    const first = items[0]!;
    expect(first.kind).toBe("assistant");
    if (first.kind !== "assistant") return;
    expect(first.toolCalls).toHaveLength(1);
    expect(first.toolCalls[0]!.tool).toBe("file_read");
    expect(first.toolCalls[0]!.status).toBe("done");
    expect(first.toolCalls[0]!.invocationId).toBe("inv-1");
  });

  it("skips malformed entries without throwing", () => {
    const items = messagesToTranscript([
      null,
      "string",
      { role: "user", content: "not an array" },
      { role: "user" }, // missing content
      { content: [{ type: "text", text: "x" }] }, // missing role
      { role: "unknown", content: [] },
    ]);
    expect(items).toHaveLength(0);
  });
});
