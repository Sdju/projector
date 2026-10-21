import { describe, expect, it } from "vite-plus/test";
import {
  defaultThinkingStyle,
  quietThinkingBody,
  thinkingBody,
  thinkingLevel,
  thinkingOptions,
} from "../server/modules/providers/thinking.ts";

describe("thinking adapter", () => {
  it("speaks the dialect of each provider", () => {
    expect(thinkingBody("qwen", "off")).toEqual({ enable_thinking: false });
    expect(thinkingBody("qwen")).toEqual({ enable_thinking: true });
    expect(thinkingBody("vllm", "off")).toEqual({
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(thinkingBody("deepseek", "max")).toEqual({
      thinking: { type: "enabled" },
      reasoning_effort: "max",
    });
    expect(thinkingBody("deepseek", "off")).toEqual({ thinking: { type: "disabled" } });
    expect(thinkingBody("ollama", "off")).toEqual({ reasoning_effort: "none" });
    expect(thinkingBody("openai", "low")).toEqual({ reasoning_effort: "low" });
    expect(thinkingBody("openrouter", "high")).toEqual({ reasoning: { effort: "high" } });
    expect(thinkingBody("openrouter", "off")).toEqual({ reasoning: { enabled: false } });
    expect(thinkingBody("none", "high")).toBeUndefined();
  });

  it("falls back to the initial level for a choice the dialect does not have", () => {
    expect(thinkingLevel("deepseek", "on")).toBe("high");
    expect(thinkingLevel("openai", "off")).toBe("medium");
    expect(thinkingLevel("qwen", "high")).toBe("on");
  });

  it("offers off only where the provider can switch it off", () => {
    expect(thinkingOptions("qwen").map((item) => item.value)).toEqual(["off", "on"]);
    expect(thinkingOptions("openai").map((item) => item.value)).not.toContain("off");
    expect(thinkingOptions("none")).toEqual([]);
  });

  it("keeps side requests quiet", () => {
    expect(quietThinkingBody("qwen")).toEqual({ enable_thinking: false });
    expect(quietThinkingBody("openai")).toEqual({ reasoning_effort: "minimal" });
    expect(quietThinkingBody("none")).toBeUndefined();
  });

  it("picks a dialect by provider kind", () => {
    expect(defaultThinkingStyle("qwencloud")).toBe("qwen");
    expect(defaultThinkingStyle("deepseek")).toBe("deepseek");
    expect(defaultThinkingStyle("custom")).toBe("none");
  });
});
