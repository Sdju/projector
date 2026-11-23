import type {
  BuiltinProviderKind,
  ProviderKind,
  ProviderKindInfo,
  ThinkingStyle,
} from "./types.ts";

export interface ProviderPreset {
  label: string;
  name: string;
  url: string;
  /** Shown before the address is chosen; never saved as a value. */
  urlPlaceholder?: string;
  /** Model registered with a new provider of this kind; the rest come from "load the list". */
  model: string;
  keyPlaceholder: string;
  /** The thinking dialect a new provider of this kind starts with. */
  thinking: ThinkingStyle;
  /** What Projector can show about the account besides chat. */
  hint: string;
}

/** Presets that need no provider-specific module; a kind may register its own at composition. */
const BUILT_IN_PRESETS: Record<"deepseek" | "openrouter" | "local" | "custom", ProviderPreset> = {
  deepseek: {
    thinking: "deepseek",
    label: "DeepSeek",
    name: "DeepSeek",
    url: "https://api.deepseek.com",
    model: "deepseek-chat",
    keyPlaceholder: "sk-… с platform.deepseek.com",
    hint: "Баланс аккаунта показывается в статусной строке и обновляется раз в минуту.",
  },
  openrouter: {
    thinking: "openrouter",
    label: "OpenRouter",
    name: "OpenRouter",
    url: "https://openrouter.ai/api/v1",
    model: "openrouter/auto",
    keyPlaceholder: "sk-or-… с openrouter.ai/settings/keys",
    hint: "API key используется для моделей, отдельный management key — для остатка кредитов. Баланс обновляется раз в минуту.",
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

const presets = new Map<string, ProviderPreset>(Object.entries(BUILT_IN_PRESETS));

/** Пресет вида: встроенный или пришедший из модуля провайдера до первого экрана. */
export function registerProviderPreset(kind: string, preset: ProviderPreset): void {
  presets.set(kind, preset);
}

/**
 * Built-in kinds keep their order in the settings list even when their preset arrives from a
 * separate module; an unknown kind is still editable with the plain preset.
 */
export const BUILTIN_PROVIDER_KINDS: readonly BuiltinProviderKind[] = [
  "deepseek",
  "openrouter",
  "qwencloud",
  "local",
  "custom",
];

/** A plugin kind gets a plain OpenAI-compatible preset with the URL the plugin named. */
export function providerPreset(kind: ProviderKind, info?: ProviderKindInfo): ProviderPreset {
  const preset = presets.get(kind);
  if (preset) return preset;
  return {
    label: info?.title ?? kind,
    name: info?.title ?? kind,
    url: info?.url ?? "",
    model: info?.model ?? "",
    keyPlaceholder: "API key",
    thinking: "none",
    hint: info?.description ?? "Вид провайдера и его баланс предоставил плагин.",
  };
}

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
