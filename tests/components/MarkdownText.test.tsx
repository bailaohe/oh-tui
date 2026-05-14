import { describe, it, expect } from "vitest";
import { tokenize } from "../../src/lib/markdown.js";

describe("markdown tokenize", () => {
  it("recognizes heading", () => {
    const t = tokenize("# Hello");
    expect(t[0]?.type).toBe("heading");
  });

  it("recognizes code block", () => {
    const t = tokenize("```py\nprint(1)\n```");
    expect(t[0]).toMatchObject({ type: "code_block", lang: "py" });
  });

  it("recognizes list items", () => {
    const t = tokenize("- one\n- two");
    expect(t.length).toBe(2);
    expect(t.every((x) => x.type === "list_item")).toBe(true);
  });

  it("inline bold + code", () => {
    const t = tokenize("hello **world** `x`");
    expect(t[0]?.type).toBe("paragraph");
  });
});
