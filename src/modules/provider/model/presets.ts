import type { ProviderKind } from "./types.ts";

export interface ProviderPreset {
  label: string;
  name: string;
  url: string;
  model: string;
  keyPlaceholder: string;
  /** What Projector can show about the account besides chat. */
  hint: string;
}

export const PROVIDER_PRESETS: Record<ProviderKind, ProviderPreset> = {
  deepseek: {
    label: "DeepSeek",
    name: "DeepSeek",
    url: "https://api.deepseek.com",
    model: "deepseek-chat",
    keyPlaceholder: "sk-… с platform.deepseek.com",
    hint: "Баланс аккаунта показывается в статусной строке и обновляется раз в минуту.",
  },
  qwencloud: {
    label: "Qwen Cloud",
    name: "Qwen / DashScope",
    url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.8-flash",
    keyPlaceholder: "DASHSCOPE / QWENCLOUD",
    hint: "Qwen Cloud не отдаёт баланс по ключу API: остаток смотрите в консоли QwenCloud.",
  },
  local: {
    label: "Локальный (Ollama, LM Studio…)",
    name: "Локальный",
    url: "http://localhost:11434/v1",
    model: "",
    keyPlaceholder: "обычно не нужен",
    hint: "Локальному провайдеру баланс не нужен, ключ обычно не требуется.",
  },
  custom: {
    label: "Другой OpenAI-compatible",
    name: "Провайдер",
    url: "",
    model: "",
    keyPlaceholder: "API key",
    hint: "Для этого провайдера баланс недоступен.",
  },
};

export const PROVIDER_KINDS = Object.keys(PROVIDER_PRESETS) as ProviderKind[];
