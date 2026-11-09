import {
  clientAgentByBackend,
  type AgentPlanItem,
} from "../../agents-integration/catalog/index.ts";
import type { AgentTurn } from "../model/types.ts";

export type PlanItem = AgentPlanItem;

/** The list the agent kept in this answer: its reader finds the latest plan call, `[]` for a clear. */
function planOf(turn: AgentTurn | undefined, backend: string): PlanItem[] | undefined {
  if (turn?.role !== "assistant") return undefined;
  const read = clientAgentByBackend(backend)?.plan;
  if (!read) return undefined;
  for (const tool of turn.tools.toReversed()) {
    if (!tool.input) continue;
    const items = read({ name: tool.name, input: tool.input });
    if (items) return items;
  }
  return undefined;
}

/** The task list the agent kept in its last answer, if any. */
export function latestPlan(turn: AgentTurn | undefined, backend: string): PlanItem[] {
  return planOf(turn, backend) ?? [];
}

/**
 * The plan the chat pins: the last answer's list while it has unfinished items, or the latest one
 * that still does; a finished plan shows only for the answer that finished it.
 */
export function shownPlan(turns: AgentTurn[], backend: string): PlanItem[] {
  const answers = turns.filter((turn) => turn.role === "assistant");
  for (const turn of answers.toReversed()) {
    const items = planOf(turn, backend);
    if (!items) continue;
    return turn === answers.at(-1) || items.some((item) => item.status !== "completed")
      ? items
      : [];
  }
  return [];
}
