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
  apiKey: string;
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

export interface AgentHistoryTurn {
  role: "user" | "assistant";
  content: string;
}
