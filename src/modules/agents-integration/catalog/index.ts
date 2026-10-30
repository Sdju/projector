import type { Component } from "vue";

/**
 * What the client knows about an agent: the backend that answers in the chat, the terminal
 * program it stands for and how it is shown in menus and settings. Agents register themselves;
 * the shared code reads this catalog instead of naming them.
 */
export interface ClientAgent {
  /** Backend id of the agent (`claude-code`). */
  backend: string;
  /** Terminal program that starts the agent (`claude`). */
  program: string;
  title: string;
  caption: string;
  icon: Component;
  /** The built-in Projector agent: it has a chat but no terminal program. */
  builtin?: boolean;
  /** The limits indicator of the agent, if it has one. */
  usage?: Component;
}

const agents = new Map<string, ClientAgent>();

/** Registers an agent; registering the same backend again replaces it and keeps the order. */
export function registerClientAgent(agent: ClientAgent): void {
  agents.set(agent.backend, agent);
}

/** Every registered agent, in registration order. */
export function clientAgents(): ClientAgent[] {
  return [...agents.values()];
}

/** The external agent behind a terminal program; the built-in agent has none. */
export function clientAgentOf(program: string): ClientAgent | undefined {
  return clientAgents().find((agent) => !agent.builtin && agent.program === program);
}

/** The agent behind a chat backend, built-in included. */
export function clientAgentByBackend(backend: string): ClientAgent | undefined {
  return agents.get(backend);
}

/** Terminal programs of the external agents, in registration order. */
export function clientAgentPrograms(): string[] {
  return clientAgents()
    .filter((agent) => !agent.builtin)
    .map((agent) => agent.program);
}
