import type { UsageBreakdown } from "@ai-projector/core/modules/usage-analytics/index.ts";
import { clientAgents } from "../../agents-integration/catalog/index.ts";

/** One row of a breakdown: a label, its tokens and the share of the total. */
export interface BreakdownRow {
  label: string;
  value: number;
  share: number;
}

/** Token kinds in the order the stacked charts draw them, from cache to the answer. */
export const usageTokenSeries = [
  { key: "cacheRead", label: "Из кэша", color: "var(--info)" },
  { key: "input", label: "Без кэша", color: "var(--run)" },
  { key: "cacheWrite", label: "Запись в кэш", color: "var(--warn)" },
  { key: "output", label: "Ответ", color: "var(--err)" },
];

const TOP = 6;

/** The agent's own title from the catalog; an id from an unknown backend stays as it is. */
export function agentTitle(id: string): string {
  const agent = clientAgents().find((item) => item.backend === id || item.program === id);
  return agent?.title ?? (id === "неизвестный" ? "Без агента" : id);
}

/** Where a token went: a chat answer or one of Projector's short service calls. */
export function taskLabel(key: string): string {
  switch (key) {
    case "chat":
      return "Чат Projector";
    case "lens":
      return "Lens";
    case "judge":
      return "Судья";
    case "doctor-form":
      return "Доктор форм";
    case "doctor-answer":
      return "Доктор ответов";
    case "compaction":
      return "Сжатие истории";
    case "review":
      return "Проверка команд";
    case "task":
      return "Task · исследование";
    default:
      return key.startsWith("agent:")
        ? `${key === "agent:unknown" ? "Без агента" : agentTitle(key.slice(6))} · чат`
        : key;
  }
}

/** Biggest rows first, with everything past the top folded into one honest row. */
export function breakdownRows(
  items: readonly UsageBreakdown[],
  total: number,
  label: (key: string) => string,
): BreakdownRow[] {
  const rows = items.map((item) => ({
    label: label(item.key),
    value: item.tokens,
    share: total ? item.tokens / total : 0,
  }));
  if (rows.length <= TOP) return rows;
  const head = rows.slice(0, TOP);
  const rest = rows.slice(TOP).reduce((sum, row) => sum + row.value, 0);
  if (rest) head.push({ label: "Другие", value: rest, share: total ? rest / total : 0 });
  return head;
}
