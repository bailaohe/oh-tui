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
