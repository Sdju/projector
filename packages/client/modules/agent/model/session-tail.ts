import type { AgentTurn } from "./types.ts";

/** The native session the last answer continued; a detached chat has none. */
export function sessionIdOf(turns: AgentTurn[]): string | undefined {
  const last = turns.findLast((item) => item.role === "assistant");
  return last && !last.detached ? last.session?.id : undefined;
}

/** Where the kept conversation ends in the agent's transcript (Claude Code branches from it). */
export function tailOf(turns: AgentTurn[]): string | undefined {
  return turns.findLast((item) => item.role === "assistant")?.tail;
}
