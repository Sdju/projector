export type ProviderKind = "custom" | "local" | "deepseek" | "qwencloud";

/** `id` goes upstream; `alias` is the name the agent and other clients see. */
export interface ProviderModel {
  id: string;
  alias: string;
}

export interface OpenAIProviderPublic {
  id: string;
  name: string;
  kind: ProviderKind;
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
