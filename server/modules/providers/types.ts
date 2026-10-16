export interface OpenAIProviderPublic {
  id: string;
  name: string;
  url: string;
  model: string;
  hasApiKey: boolean;
}

export interface OpenAIProviderWrite {
  id: string;
  name: string;
  url: string;
  model: string;
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
  url: string;
  model: string;
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
  url: string;
  model: string;
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
