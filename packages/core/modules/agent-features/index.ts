/**
 * Optional abilities a chat agent can be given: what the model is told when the ability is on.
 * The server fills the catalog; the client only renders the result of `/api/agent/features`.
 * A feature is delivered by its own backend (a system prompt, the first message of a session),
 * so nothing here knows how a particular agent receives the text.
 */
export interface AgentFeature {
  /** Stable id used by the settings file and the IDE commands. */
  id: string;
  title: string;
  /** One line for the island: what the agent gains. */
  summary: string;
  /** The text of the ability: what it is, when to use it and how. */
  instruction: () => string;
  /** Agents that have it until the user changes something. */
  defaults?: string[];
}

export interface AgentFeatureCatalog {
  /** Registering an id again replaces it. */
  register(feature: AgentFeature): void;
  list(): AgentFeature[];
  get(id: string): AgentFeature | undefined;
}

export function createAgentFeatureCatalog(): AgentFeatureCatalog {
  const items = new Map<string, AgentFeature>();
  return {
    register: (feature) => void items.set(feature.id, feature),
    list: () => [...items.values()],
    get: (id) => items.get(id),
  };
}
