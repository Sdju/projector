import type { ProviderKind } from "./types.ts";

/**
 * How a provider asks a model to think. Every API has its own switch, so one adapter turns the
 * level chosen in the chat into the request fields of the provider's dialect.
 *
 * - `qwen`: DashScope and Qwen Cloud, `enable_thinking` on or off.
 * - `vllm`: vLLM, llama.cpp and SGLang, `chat_template_kwargs.enable_thinking`.
 * - `deepseek`: `thinking.type` plus `reasoning_effort` low, high or max.
 * - `ollama`: Ollama and LM Studio, `reasoning_effort` with `none` to switch it off.
 * - `openai`: OpenAI, `reasoning_effort` from minimal to high; thinking cannot be switched off.
 * - `openrouter`: OpenRouter, `reasoning.effort` or `reasoning.enabled: false`.
 * - `none`: the provider has no such knob; nothing is sent.
 */
export type ThinkingStyle =
  | "none"
  | "qwen"
  | "vllm"
  | "deepseek"
  | "ollama"
  | "openai"
  | "openrouter";

export const THINKING_STYLES: readonly ThinkingStyle[] = [
  "none",
  "qwen",
  "vllm",
  "deepseek",
  "ollama",
  "openai",
  "openrouter",
];

export function isThinkingStyle(value: unknown): value is ThinkingStyle {
  return typeof value === "string" && THINKING_STYLES.includes(value as ThinkingStyle);
}

/** Request fields as the SDK takes them: plain JSON. */
export type ThinkingBody = { [key: string]: ThinkingBody | string | boolean };

/** The level that switches thinking off. */
export const THINKING_OFF = "off";

interface Profile {
  /** Levels above "off", weakest first. */
  levels: readonly string[];
  /** The level used until the user picks one. */
  initial: string;
  /** The provider can switch thinking off. */
  canOff: boolean;
  /** The request fields for a level (one of `levels`) or for "off". */
  body(level: string): ThinkingBody;
}

const toggle = (field: (on: boolean) => ThinkingBody): Profile => ({
  levels: ["on"],
  initial: "on",
  canOff: true,
  body: (level) => field(level !== THINKING_OFF),
});

const PROFILES: Record<Exclude<ThinkingStyle, "none">, Profile> = {
  qwen: toggle((on) => ({ enable_thinking: on })),
  vllm: toggle((on) => ({ chat_template_kwargs: { enable_thinking: on } })),
  deepseek: {
    levels: ["low", "high", "max"],
    initial: "high",
    canOff: true,
    body: (level): ThinkingBody => {
      if (level === THINKING_OFF) return { thinking: { type: "disabled" } };
      return { thinking: { type: "enabled" }, reasoning_effort: level };
    },
  },
  ollama: {
    levels: ["low", "medium", "high"],
    initial: "medium",
    canOff: true,
    body: (level) => ({ reasoning_effort: level === THINKING_OFF ? "none" : level }),
  },
  openai: {
    levels: ["minimal", "low", "medium", "high"],
    initial: "medium",
    canOff: false,
    body: (level) => ({ reasoning_effort: level }),
  },
  openrouter: {
    levels: ["low", "medium", "high"],
    initial: "medium",
    canOff: true,
    body: (level): ThinkingBody => {
      if (level === THINKING_OFF) return { reasoning: { enabled: false } };
      return { reasoning: { effort: level } };
    },
  },
};

const NAMES: Record<string, string> = {
  off: "Выключено",
  on: "Включено",
  minimal: "Минимальное",
  low: "Низкое",
  medium: "Среднее",
  high: "Высокое",
  max: "Максимальное",
};

/** The dialect a provider of this kind speaks until the user picks another one. */
export function defaultThinkingStyle(kind: ProviderKind): ThinkingStyle {
  if (kind === "qwencloud") return "qwen";
  if (kind === "deepseek") return "deepseek";
  if (kind === "local") return "ollama";
  return "none";
}

/** Levels to choose from, as options of a chat control; empty when the provider has no knob. */
export function thinkingOptions(style: ThinkingStyle): Array<{ value: string; name: string }> {
  if (style === "none") return [];
  const profile = PROFILES[style];
  const levels = profile.canOff ? [THINKING_OFF, ...profile.levels] : profile.levels;
  return levels.map((value) => ({ value, name: NAMES[value] ?? value }));
}

/** The level a request uses: the chosen one when this dialect has it, else the initial one. */
export function thinkingLevel(style: ThinkingStyle, chosen?: string): string {
  if (style === "none") return THINKING_OFF;
  const profile = PROFILES[style];
  if (chosen === THINKING_OFF && profile.canOff) return THINKING_OFF;
  return profile.levels.includes(chosen ?? "") ? chosen! : profile.initial;
}

/** Request fields that ask for `chosen` thinking; `undefined` when the provider has no such knob. */
export function thinkingBody(style: ThinkingStyle, chosen?: string): ThinkingBody | undefined {
  if (style === "none") return undefined;
  return PROFILES[style].body(thinkingLevel(style, chosen));
}

/** Request fields for the cheapest answer: thinking off, or the lowest level where it cannot be off. */
export function quietThinkingBody(style: ThinkingStyle): ThinkingBody | undefined {
  if (style === "none") return undefined;
  const profile = PROFILES[style];
  return profile.body(profile.canOff ? THINKING_OFF : profile.levels[0]!);
}
