import { describe, expect, it } from "vite-plus/test";
import {
  budgetNote,
  isLooping,
  tokensSpent,
  turnBudget,
} from "../server/modules/agents/projector/projector-budget.ts";

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

describe("time and token limits", () => {
  const done = (usage) => ({ ...step("a", Math.random(), 1), usage });

  it("stops on tokens spent by all steps", () => {
    const budget = turnBudget({ seconds: 0, tokens: 100 });
    const steps = [done({ inputTokens: 50, outputTokens: 10 }), done({ inputTokens: 40 })];
    expect(tokensSpent(steps)).toBe(100);
    expect(budget.stopWhen.some((stop) => stop({ steps }))).toBe(true);
    expect(budget.reason()).toBe("tokens");
    expect(budgetNote("tokens")).toContain("токенов");
  });

  it("stops on time and lets limits of 0 pass", () => {
    let clock = 0;
    const budget = turnBudget({ seconds: 10, tokens: 0 }, () => clock);
    const steps = [done({})];
    expect(budget.stopWhen.some((stop) => stop({ steps }))).toBe(false);
    clock = 10_000;
    expect(budget.stopWhen.some((stop) => stop({ steps }))).toBe(true);
    expect(budget.reason()).toBe("time");
  });
});
