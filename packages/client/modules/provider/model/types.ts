export type {
  ProviderModelCapability,
  ProviderModelCatalog,
  ProviderModelInfo,
  ProviderModelKind,
  ProviderModelModality,
  ProviderModelPrice,
} from "@ai-projector/core/modules/providers/index.ts";

export type BuiltinProviderKind = "custom" | "local" | "deepseek" | "openrouter" | "qwencloud";

/** Built-in presets plus kinds contributed by trusted balance plugins. */
export type ProviderKind = BuiltinProviderKind | (string & {});

/** How the provider is asked to think; the server turns the chosen level into its own request fields. */
export type ThinkingStyle =
  | "none"
  | "qwen"
  | "vllm"
  | "deepseek"
  | "ollama"
  | "openai"
  | "openrouter";

/** What a million tokens cost, in the currency of the provider's tariff. */
export interface ModelPrice {
  /** Until both `input` and `output` are set the server does not keep the price. */
  input?: number;
  output?: number;
  /** Tokens served from the cache; unset means the price of `input`. */
  cacheRead?: number;
}

/** `id` goes upstream; `alias` is the name the agent and other clients see. */
export interface ProviderModel {
  id: string;
  alias: string;
  /** Context window in tokens; the agent's context ring is measured against it. */
  contextTokens?: number;
  /** Price of a million tokens; the chat shows what an answer and the whole chat cost. */
  price?: ModelPrice;
  /** `false`: the model has no thinking mode; unset means it can think. */
  thinking?: boolean;
}

export interface OpenAIProviderPublic {
  id: string;
  name: string;
  kind: ProviderKind;
  thinkingStyle: ThinkingStyle;
  /** Registered name of the model that answers when the chosen one keeps failing. */
  fallbackModel?: string;
  url: string;
  enabled: boolean;
  models: ProviderModel[];
  hasApiKey: boolean;
  hasBalanceApiKey?: boolean;
}

export interface ProviderKindInfo {
  kind: string;
  title: string;
  description?: string;
  url?: string;
  model?: string;
  plugin?: string;
}

export interface OpenAIProvidersPublicState {
  activeProviderId: string | null;
  providers: OpenAIProviderPublic[];
  balanceKinds: ProviderKindInfo[];
  /** Виды провайдеров с читателем расхода. */
  usageKinds: ProviderKindInfo[];
}

export interface ProviderBalanceEntry {
  currency: string;
  total: string;
  granted: string;
  toppedUp: string;
}

export interface ProviderBalance {
  status: "ready" | "unavailable" | "unsupported";
  entries: ProviderBalanceEntry[];
  available: boolean | null;
  checkedAt: number;
  message: string | null;
  providerId?: string;
  providerName?: string;
  providerKind?: string;
}

export interface ProviderUsageQuota {
  modelId: string;
  remaining: string | null;
  total: string | null;
  unit: string | null;
  percent: number | null;
  status: string | null;
}

/** Расход и квоты провайдера; это не остаток кошелька. */
export interface ProviderUsage {
  status: "ready" | "unavailable";
  period: { from: string; to: string } | null;
  currency: string | null;
  spend: string | null;
  quotas: ProviderUsageQuota[];
  plan: string | null;
  credits: { total: number; remaining: number } | null;
  checkedAt: number;
  message: string | null;
}
