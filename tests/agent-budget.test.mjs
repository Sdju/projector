import { describe, expect, it } from "vite-plus/test";
import { isLooping } from "../server/modules/agents/projector/projector-budget.ts";

const step = (name, input, output) => ({
  toolCalls: [{ toolName: name, input }],
  toolResults: [{ output }],
});

describe("turn budget", () => {
  it("detects the same call with the same result repeated", () => {
    const same = step("bash", { c: "ls" }, "err");
    expect(isLooping([same, same, same])).toBe(true);
  });

  it("does not stop on progress, differing results or text-only steps", () => {
    expect(isLooping([step("a", 1, 1), step("a", 1, 2), step("a", 1, 3)])).toBe(false);
    expect(isLooping([step("a", 1, 1), step("a", 1, 1)])).toBe(false);
    expect(isLooping([{}, {}, {}])).toBe(false);
  });
});
