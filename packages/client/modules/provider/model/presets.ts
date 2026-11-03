import type { ProviderKind, ThinkingStyle } from "./types.ts";

export interface ProviderPreset {
  label: string;
  name: string;
  url: string;
  /** Model registered with a new provider of this kind; the rest come from "load the list". */
  model: string;
  keyPlaceholder: string;
  /** The thinking dialect a new provider of this kind starts with. */
  thinking: ThinkingStyle;
  /** What Projector can show about the account besides chat. */
  hint: string;
}

export const PROVIDER_PRESETS: Record<ProviderKind, ProviderPreset> = {
  deepseek: {
    thinking: "deepseek",
    label: "DeepSeek",
    name: "DeepSeek",
    url: "https://api.deepseek.com",
    model: "deepseek-chat",
    keyPlaceholder: "sk-… с platform.deepseek.com",
    hint: "Баланс аккаунта показывается в статусной строке и обновляется раз в минуту.",
  },
  qwencloud: {
    thinking: "qwen",
    label: "Qwen Cloud",
    name: "Qwen / DashScope",
    url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.8-flash",
    keyPlaceholder: "DASHSCOPE / QWENCLOUD",
    hint: "Qwen Cloud не отдаёт баланс по ключу API: остаток смотрите в консоли QwenCloud.",
  },
  local: {
    thinking: "ollama",
    label: "Локальный (Ollama, LM Studio…)",
    name: "Локальный",
    url: "http://localhost:11434/v1",
    model: "",
    keyPlaceholder: "обычно не нужен",
    hint: "Локальному провайдеру баланс не нужен, ключ обычно не требуется.",
  },
  custom: {
    thinking: "none",
    label: "Другой OpenAI-compatible",
    name: "Провайдер",
    url: "",
    model: "",
    keyPlaceholder: "API key",
    hint: "Для этого провайдера баланс недоступен.",
  },
};

export const PROVIDER_KINDS = Object.keys(PROVIDER_PRESETS) as ProviderKind[];

/** Names of the thinking dialects in the provider settings. */
export const THINKING_STYLES: Array<{ value: ThinkingStyle; label: string }> = [
  { value: "none", label: "Не передавать" },
  { value: "qwen", label: "Qwen / DashScope (enable_thinking)" },
  { value: "vllm", label: "vLLM, llama.cpp (chat_template_kwargs)" },
  { value: "deepseek", label: "DeepSeek (thinking + reasoning_effort)" },
  { value: "ollama", label: "Ollama, LM Studio (reasoning_effort, можно выключить)" },
  { value: "openai", label: "OpenAI (reasoning_effort)" },
  { value: "openrouter", label: "OpenRouter (reasoning)" },
];
