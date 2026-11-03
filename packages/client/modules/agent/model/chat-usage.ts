import type { AgentTurn, ChatUsage } from "./types.ts";

const same = (a: ChatUsage, b: ChatUsage) =>
  a.tokens === b.tokens && a.cost === b.cost && a.priced === b.priced;

/**
 * What the chat has used up to and including each answer, for the usage tooltip. An entry that did
 * not change keeps the object it had in `previous`, so answers are not redrawn while a new one streams.
 */
export function chatUsageByTurn(
  turns: readonly AgentTurn[],
  previous?: ReadonlyMap<string, ChatUsage>,
): Map<string, ChatUsage> {
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
    const before = previous?.get(turn.id);
    totals.set(turn.id, before && same(before, sum) ? before : { ...sum });
  }
  return totals;
}
