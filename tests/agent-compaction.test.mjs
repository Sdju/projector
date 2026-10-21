import { MockLanguageModelV3 } from "ai/test";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  clearCompactionCache,
  compactHistory,
  summarySection,
} from "../server/modules/agents/projector/projector-compaction.ts";

const mock = (answer, calls) =>
  new MockLanguageModelV3({
    doGenerate: async (options) => {
      calls.push(JSON.stringify(options.prompt));
      if (answer instanceof Error) throw answer;
      return {
        content: [{ type: "text", text: answer }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });

const long = (n, mark = "") => {
  const turns = [];
  for (let i = 0; i < n; i++) {
    turns.push({ role: "user", content: `${mark}вопрос ${i} ${"x".repeat(9000)}` });
    turns.push({ role: "assistant", content: `ответ ${i} ${"y".repeat(9000)}` });
  }
  return turns;
};

describe("history compaction", () => {
  beforeEach(clearCompactionCache);

  it("leaves a short history alone", async () => {
    const calls = [];
    const result = await compactHistory(mock("сводка", calls), long(2));
    expect(result.summary).toBe("");
    expect(result.recent).toHaveLength(4);
    expect(calls).toHaveLength(0);
  });

  it("summarizes the turns that no longer fit", async () => {
    const calls = [];
    const history = long(8);
    const result = await compactHistory(mock("цель: настроить Docker", calls), history);
    expect(result.summary).toBe("цель: настроить Docker");
    expect(result.recent.length).toBeLessThan(history.length);
    expect(result.recent[0].role).toBe("user");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("вопрос 0");
  });

  it("reuses the summary and continues it for new turns", async () => {
    const calls = [];
    const model = mock("первая сводка", calls);
    await compactHistory(model, long(8));
    await compactHistory(model, long(8));
    expect(calls).toHaveLength(1);
    await compactHistory(model, long(9));
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("первая сводка");
    expect(calls[1]).not.toContain("вопрос 0 ");
  });

  it("drops the old turns when summarizing fails", async () => {
    const result = await compactHistory(mock(new Error("down"), []), long(8));
    expect(result.summary).toBe("");
    expect(result.recent.length).toBeLessThan(16);
  });

  it("puts the summary into the system prompt", () => {
    expect(summarySection("")).toBe("");
    expect(summarySection("итог")).toContain("итог");
  });
});
