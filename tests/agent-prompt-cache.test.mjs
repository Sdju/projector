import { describe, expect, it } from "vite-plus/test";
import { buildSystemPrompt } from "../server/modules/agents/projector/prompts.ts";
import { contextOf, tokensOf } from "../server/modules/agents/projector/projector-usage.ts";

describe("prompt cache", () => {
  it("builds a byte-identical system prompt every time, so the provider can cache its prefix", () => {
    expect(buildSystemPrompt("гайд")).toBe(buildSystemPrompt("гайд"));
    expect(buildSystemPrompt("гайд")).not.toMatch(/\b20\d\d-\d\d-\d\d\b|Date|\d{2}:\d{2}:\d{2}/);
  });

  it("splits the prompt into cached and fresh tokens", () => {
    expect(
      tokensOf({
        inputTokens: 1000,
        outputTokens: 50,
        inputTokenDetails: { noCacheTokens: 200, cacheReadTokens: 800, cacheWriteTokens: 0 },
      }),
    ).toEqual({ input: 200, output: 50, cacheRead: 800, cacheWrite: 0 });
    expect(tokensOf({ inputTokens: 300, outputTokens: 1 })).toEqual({
      input: 300,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
    });
    expect(tokensOf(undefined).input).toBe(0);
  });

  it("fills the window from the last request, with cached tokens counted once", () => {
    const steps = [
      {
        inputTokens: 9229,
        outputTokens: 216,
        inputTokenDetails: { noCacheTokens: 9229, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
      {
        inputTokens: 25000,
        outputTokens: 400,
        inputTokenDetails: { noCacheTokens: 2000, cacheReadTokens: 23000, cacheWriteTokens: 0 },
      },
    ];
    // The sum of both prompts would be 34845 and would trip autocompact on a 128k window.
    expect(contextOf(steps)).toBe(25400);
    expect(contextOf([])).toBe(0);
  });
});

describe("usage conversion", () => {
  it("reads the cache hits of DeepSeek and of the OpenAI shape", async () => {
    const { convertUsage } = await import("../server/modules/providers/openai-client.ts");
    expect(
      convertUsage({ prompt_tokens: 100, completion_tokens: 5, prompt_cache_hit_tokens: 80 })
        .inputTokens,
    ).toEqual({
      total: 100,
      noCache: 20,
      cacheRead: 80,
      cacheWrite: 0,
    });
    const openai = convertUsage({
      prompt_tokens: 100,
      prompt_tokens_details: { cached_tokens: 60, cache_write_tokens: 10 },
    });
    expect(openai.inputTokens).toMatchObject({ noCache: 30, cacheRead: 60, cacheWrite: 10 });
    expect(convertUsage(null).inputTokens.total).toBe(0);
  });
});
