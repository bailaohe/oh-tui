// @vitest-environment jsdom
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
