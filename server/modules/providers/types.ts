import type { ThinkingStyle } from "./thinking.ts";

/** Preset of a provider: decides which extras (balance, defaults) Projector offers. */
export type ProviderKind = "custom" | "local" | "deepseek" | "qwencloud";

/** A model of a provider that Projector offers: `id` goes upstream, `alias` is the name clients see. */
export interface ProviderModel {
  id: string;
  alias: string;
  /** Context window in tokens, when the user told it; the agent measures its context against it. */
  contextTokens?: number;
  /** `false` when the model has no thinking mode, so the request must not ask for it; unset means it can. */
  thinking?: boolean;
}

export interface OpenAIProviderPublic {
  id: string;
  name: string;
  kind: ProviderKind;
  /** The dialect in which the provider is asked to think. */
  thinkingStyle: ThinkingStyle;
  url: string;
  /** A disabled provider offers none of its models to the agent or the gateway. */
  enabled: boolean;
  models: ProviderModel[];
  hasApiKey: boolean;
}

export interface OpenAIProviderWrite {
  id: string;
  name: string;
  kind?: ProviderKind;
  thinkingStyle?: ThinkingStyle;
  url: string;
  enabled?: boolean;
  models?: Array<{ id: string; alias?: string; contextTokens?: number; thinking?: boolean }>;
  /** Shorthand for a single model, for callers that only know one. */
  model?: string;
  apiKey?: string;
}

export interface OpenAIProvidersPublicState {
  activeProviderId: string | null;
  providers: OpenAIProviderPublic[];
}

export interface OpenAIProvidersWriteState {
  activeProviderId: string | null;
  providers: OpenAIProviderWrite[];
}

export interface StoredOpenAIProvider {
  id: string;
  name: string;
  kind: ProviderKind;
  thinkingStyle: ThinkingStyle;
  url: string;
  enabled: boolean;
  models: ProviderModel[];
  /** Obfuscated key kept in the providers file; empty when the key lives in the keyring. */
  apiKey: string;
  /** On disk, `keyring` means the key is in the OS keyring under the provider's account. */
  vault?: "keyring";
}

export interface StoredProvidersConfig {
  activeProviderId: string | null;
  providers: StoredOpenAIProvider[];
}

export interface EnvOpenAIFallback {
  url?: string;
  apiKey?: string;
  model?: string;
  secret?: string;
}

export interface ResolvedOpenAIProvider {
  id: string;
  name: string;
  kind: ProviderKind;
  thinkingStyle: ThinkingStyle;
  url: string;
  /** Upstream id of the chosen model: what goes into the request. */
  model: string;
  /** The registered name of the chosen model. */
  modelName: string;
  /** Context window of the chosen model in tokens, when registered. */
  contextTokens?: number;
  thinking?: boolean;
  apiKey: string;
}

/** A tool call an earlier answer made; kept so the model still sees what it did and found. */
export interface AgentHistoryTool {
  id: string;
  name: string;
  /** The call's input as JSON text. */
  input?: string;
  output: string;
  failed?: boolean;
}

export interface AgentHistoryTurn {
  role: "user" | "assistant";
  content: string;
  tools?: AgentHistoryTool[];
}

export interface ProviderBalanceEntry {
  currency: string;
  /** Decimal strings as the provider returns them; never rounded. */
  total: string;
  granted: string;
  toppedUp: string;
}

export interface ProviderBalance {
  /** `unsupported`: the provider has no balance to show (local, no public API). */
  status: "ready" | "unavailable" | "unsupported";
  entries: ProviderBalanceEntry[];
  /** The provider's own verdict whether calls still work; `null` when it does not say. */
  available: boolean | null;
  checkedAt: number;
  message: string | null;
}
