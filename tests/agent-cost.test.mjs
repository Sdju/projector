import { describe, expect, it } from "vite-plus/test";
import { sanitizeModels, resolveModel } from "../server/modules/providers/models.ts";
import { costOf } from "../server/modules/agents/projector/projector-usage.ts";

describe("model prices", () => {
  it("keeps a price only when input and output are sound numbers", () => {
    const models = sanitizeModels([
      { id: "a", price: { input: 0.3, output: "1.2", cacheRead: 0.03 } },
      { id: "b", price: { input: 1 } },
      { id: "c", price: { input: -1, output: 2 } },
      { id: "d", price: { input: "x", output: 2 } },
      { id: "e" },
    ]);
    expect(models.map((item) => item.price)).toEqual([
      { input: 0.3, output: 1.2, cacheRead: 0.03 },
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(resolveModel(models, "a", "a").price).toEqual({
      input: 0.3,
      output: 1.2,
      cacheRead: 0.03,
    });
  });

  it("prices cached tokens separately and defaults them to the input price", () => {
    const tokens = { input: 1000, output: 500, cacheRead: 9000, cacheWrite: 200 };
    expect(costOf(tokens, { input: 2, output: 8, cacheRead: 0.2 })).toBeCloseTo(
      (1000 * 2 + 9000 * 0.2 + 200 * 2 + 500 * 8) / 1e6,
    );
    expect(costOf(tokens, { input: 2, output: 8 })).toBeCloseTo((10200 * 2 + 500 * 8) / 1e6);
    expect(
      costOf({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, { input: 2, output: 8 }),
    ).toBe(0);
  });
});

describe("usage of a chat", () => {
  it("adds answers up and keeps the objects of entries that did not change", async () => {
    const { chatUsageByTurn } = await import("../src/modules/agent/model/chat-usage.ts");
    const answer = (id, cost) => ({
      id,
      role: "assistant",
      usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, ...(cost ? { cost } : {}) },
    });
    const turns = [answer("a", 0.5), { id: "u", role: "user" }, answer("b")];
    const first = chatUsageByTurn(turns);
    expect(first.get("a")).toEqual({ tokens: 150, cost: 0.5, priced: true });
    expect(first.get("b")).toEqual({ tokens: 300, cost: 0.5, priced: true });
    expect(first.has("u")).toBe(false);
    const next = chatUsageByTurn([...turns, answer("c", 1)], first);
    expect(next.get("a")).toBe(first.get("a"));
    expect(next.get("b")).toBe(first.get("b"));
    expect(next.get("c")).toEqual({ tokens: 450, cost: 1.5, priced: true });
  });
});
