import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { SelectModal } from "../../src/components/SelectModal.js";

async function flush(): Promise<void> {
  await new Promise((r) => setImmediate(r));
}

describe("SelectModal", () => {
  it("renders title + options", () => {
    const { lastFrame } = render(
      <SelectModal
        title="pick"
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ]}
        onSelect={() => {}}
        onCancel={() => {}}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("pick");
    expect(out).toContain("Alpha");
    expect(out).toContain("Beta");
  });

  it("arrow down moves selection then enter calls onSelect", async () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <SelectModal
        title="x"
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
        onSelect={onSelect}
        onCancel={() => {}}
      />,
    );
    await flush();
    stdin.write("\x1B[B"); // down
    stdin.write("\r"); // enter
    await flush();
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("esc triggers onCancel", async () => {
    const onCancel = vi.fn();
    const { stdin } = render(
      <SelectModal
        title="x"
        options={[{ value: "a", label: "A" }]}
        onSelect={() => {}}
        onCancel={onCancel}
      />,
    );
    await flush();
    stdin.write("\x1B"); // ESC
    await flush();
    expect(onCancel).toHaveBeenCalled();
  });
});
