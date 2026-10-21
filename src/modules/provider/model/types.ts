export type ProviderKind = "custom" | "local" | "deepseek" | "qwencloud";

/** How the provider is asked to think; the server turns the chosen level into its own request fields. */
export type ThinkingStyle =
  | "none"
  | "qwen"
  | "vllm"
  | "deepseek"
  | "ollama"
  | "openai"
  | "openrouter";

/** `id` goes upstream; `alias` is the name the agent and other clients see. */
export interface ProviderModel {
  id: string;
  alias: string;
  /** Context window in tokens; the agent's context ring is measured against it. */
  contextTokens?: number;
  /** `false`: the model has no thinking mode; unset means it can think. */
  thinking?: boolean;
}

export interface OpenAIProviderPublic {
  id: string;
  name: string;
  kind: ProviderKind;
  thinkingStyle: ThinkingStyle;
  url: string;
  enabled: boolean;
  models: ProviderModel[];
  hasApiKey: boolean;
}

export interface OpenAIProvidersPublicState {
  activeProviderId: string | null;
  providers: OpenAIProviderPublic[];
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
}
