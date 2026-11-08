import { describe, expect, it } from "vite-plus/test";
import {
  isLooping,
  tokensSpent,
  turnBudget,
} from "../packages/server/modules/agents/projector/projector-budget.ts";

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

describe("step limit", () => {
  const done = (usage) => ({ ...step("a", Math.random(), 1), usage });

  it("does not stop on steps when the limit is off", () => {
    const budget = turnBudget({ steps: 0 });
    const steps = Array.from({ length: 100 }, () => done({}));
    expect(budget.stopWhen.some((stop) => stop({ steps }))).toBe(false);
  });

  it("stops at a custom step limit", () => {
    const budget = turnBudget({ steps: 2 });
    const steps = [done({}), done({})];
    expect(budget.stopWhen.some((stop) => stop({ steps }))).toBe(true);
    expect(budget.reason()).toBe("steps");
  });
});
