export interface OpenAIProviderPublic {
  id: string;
  name: string;
  url: string;
  model: string;
  hasApiKey: boolean;
}

export interface OpenAIProvidersPublicState {
  activeProviderId: string | null;
  providers: OpenAIProviderPublic[];
}
