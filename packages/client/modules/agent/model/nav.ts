/** Navigation id of one agent's page inside the "agents" settings section. */
export const agentSection = (id: string) => `agent:${id}`;

/** The agent a navigation id points at, or undefined for the other sections. */
export const agentOf = (section: string): string | undefined =>
  section.startsWith("agent:") ? section.slice("agent:".length) : undefined;
