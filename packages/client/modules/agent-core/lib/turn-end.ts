/** The answer of an agent is over: the workspace may reread the files it left behind. */
export const AGENT_TURN_END_EVENT = "projector:agent-turn-end";

export interface AgentTurnEndDetail {
  projectId: string;
}

/**
 * Tells the page that an answer of this project ended. A chat without a project (the model
 * catalog) changes nothing on disk, so it does not announce anything.
 */
export function announceAgentTurnEnd(projectId: string): void {
  if (!projectId || typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AgentTurnEndDetail>(AGENT_TURN_END_EVENT, { detail: { projectId } }),
  );
}

/** Runs `reload` after every answer of this project; returns the unsubscribe function. */
export function onAgentTurnEnd(projectId: string, reload: () => void): () => void {
  const listener = (event: Event) => {
    if ((event as CustomEvent<AgentTurnEndDetail>).detail?.projectId === projectId) reload();
  };
  window.addEventListener(AGENT_TURN_END_EVENT, listener);
  return () => window.removeEventListener(AGENT_TURN_END_EVENT, listener);
}
