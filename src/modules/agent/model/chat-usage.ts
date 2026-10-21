import type { AgentTurn, ChatUsage } from "./types.ts";

/** What the chat has used up to and including each answer, for the usage tooltip. */
export function chatUsageByTurn(turns: readonly AgentTurn[]): Map<string, ChatUsage> {
  const totals = new Map<string, ChatUsage>();
  const sum: ChatUsage = { tokens: 0, cost: 0, priced: false };
  for (const turn of turns) {
    const usage = turn.usage;
    if (!usage) continue;
    sum.tokens += usage.input + usage.cacheRead + usage.cacheWrite + usage.output;
    if (usage.cost !== undefined) {
      sum.cost += usage.cost;
      sum.priced = true;
    }
    totals.set(turn.id, { ...sum });
  }
  return totals;
}
