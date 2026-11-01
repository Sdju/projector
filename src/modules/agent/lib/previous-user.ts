import type { AgentTurn } from "../model/types.ts";

/** The user message a request belongs to: the nearest one at or before this turn. */
export function previousUser(turns: AgentTurn[], id: string): string {
  const index = turns.findIndex((turn) => turn.id === id);
  return turns.slice(0, index + 1).findLast((turn) => turn.role === "user")?.id ?? "";
}
