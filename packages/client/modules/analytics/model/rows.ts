import type {
  ProviderSpend,
  UsageBreakdown,
} from "@ai-projector/core/modules/usage-analytics/index.ts";
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
    case "dictation":
      return "Диктовка";
    default:
      return key.startsWith("agent:")
        ? `${key === "agent:unknown" ? "Без агента" : agentTitle(key.slice(6))} · чат`
        : key;
  }
}

/** Combined money of every wallet in one currency; currencies are never added together. */
export interface WalletTotal {
  currency: string;
  /** `null` when no wallet in the group reported a balance. */
  total: number | null;
  /** Wallets whose balance is unknown; the sum then covers only the known part. */
  unknown: number;
  spent: number;
  toppedUp: number;
  wallets: number;
  checkedAt: number | null;
}

export function walletTotals(rows: readonly ProviderSpend[]): WalletTotal[] {
  const totals = new Map<string, WalletTotal>();
  for (const row of rows) {
    const current = totals.get(row.currency);
    if (!current) {
      totals.set(row.currency, {
        currency: row.currency,
        total: row.total,
        unknown: row.total === null ? 1 : 0,
        spent: row.spent,
        toppedUp: row.toppedUp,
        wallets: 1,
        checkedAt: row.checkedAt,
      });
      continue;
    }
    if (row.total === null) current.unknown += 1;
    else current.total = (current.total ?? 0) + row.total;
    current.spent += row.spent;
    current.toppedUp += row.toppedUp;
    current.wallets += 1;
    if (row.checkedAt !== null) current.checkedAt = Math.max(current.checkedAt ?? 0, row.checkedAt);
  }
  return [...totals.values()].sort(
    (left, right) =>
      Number(right.currency === "USD") - Number(left.currency === "USD") ||
      left.currency.localeCompare(right.currency),
  );
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
