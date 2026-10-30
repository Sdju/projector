import {
  createAgentFeatureCatalog,
  type AgentFeature,
} from "../../../core/modules/agent-features/index.ts";

/**
 * The features this server offers and the agents it can give them to. Both are filled by the
 * composition (`server/app/features.ts`), so this module never names a concrete ability or agent.
 */
export const agentFeatureCatalog = createAgentFeatureCatalog();

export interface FeatureAgent {
  /** Backend id (`projector`, `claude-code`, `codex`, …). */
  id: string;
  label: string;
}

const agents = new Map<string, FeatureAgent>();

export const registerAgentFeature = (feature: AgentFeature): void =>
  agentFeatureCatalog.register(feature);

export function registerFeatureAgent(agent: FeatureAgent): void {
  agents.set(agent.id, agent);
}

export function featureAgents(): FeatureAgent[] {
  return [...agents.values()];
}

export function hasFeatureAgent(id: string): boolean {
  return agents.has(id);
}

export { type AgentFeature };
