/**
 * What the agent chats spent and how fast the subscription limits fill up. The server collects
 * the numbers; this module keeps the shared contract and the pace rules that both the status bar
 * and the analytics page use, so one limit cannot be judged two different ways.
 */

/** Ranges the analytics page offers, in days. */
export const ANALYTICS_RANGES = [7, 30, 90] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

/** Tokens an answer used, split by how the prompt cache served them. */
export interface UsageTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Token counts of one model request as the AI SDK reports them. */
export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: {
    noCacheTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

/** What a million tokens cost; the cache prices default to the price of an ordinary input token. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** `input` counts the prompt tokens the cache did not serve, as in the usage tooltip of the chat. */
export function modelTokens(usage: ModelUsage | undefined): UsageTokens {
  const details = usage?.inputTokenDetails;
  const cacheRead = details?.cacheReadTokens ?? 0;
  const cacheWrite = details?.cacheWriteTokens ?? 0;
  const prompt = usage?.inputTokens ?? 0;
  return {
    input: details?.noCacheTokens ?? Math.max(0, prompt - cacheRead - cacheWrite),
    output: usage?.outputTokens ?? 0,
    cacheRead,
    cacheWrite,
  };
}

/** The cost of the tokens at the model's price, in the currency of its tariff. */
export function modelCost(tokens: UsageTokens, price: ModelPrice): number {
  return (
    (tokens.input * price.input +
      tokens.cacheRead * (price.cacheRead ?? price.input) +
      tokens.cacheWrite * (price.cacheWrite ?? price.input) +
      tokens.output * price.output) /
    1_000_000
  );
}

/** Where a cost came from: the agent's own journal, Projector's tariff, or nowhere. */
export type UsageCostSource = "recorded" | "computed" | "none";

/** One model request as an agent writes it into its native journal. */
export interface UsageLogEvent {
  /** Native session id the request belongs to. */
  session: string;
  /** Stable id inside the session: a log line or a message id. */
  event: string;
  /** When the request finished, ms since the epoch. */
  at: number;
  model?: string;
  /** Working directory of the native session, used to place it into a Projector project. */
  cwd?: string;
  tokens: UsageTokens;
  /** Money the agent itself recorded, in the currency of its own report. */
  cost?: number;
  costSource: UsageCostSource;
}

/** Result of one journal read: all events, or an incremental slice with a new cursor. */
export interface UsageLogRead {
  events: UsageLogEvent[];
  /** Opaque cursor for the next read; `append` readers use it to skip old rows. */
  state?: string;
}

/** A reader of one agent's native journals; every agent module ships its own. */
export interface UsageLogReader {
  /** Backend id of the agent (`codex`, `opencode`, `kimi`). */
  agent: string;
  /** Human title for the sources card. */
  label: string;
  /** Directories the reader watches; missing ones mean the agent was never used. */
  roots(): string[];
  /** Files that can hold usage; a missing root is not an error. */
  files(): Promise<string[]>;
  /** Largest file worth reading; a database journal is bigger than a JSONL rollout. */
  maxBytes?: number;
  /** True when `read` returns only changes for this file: old events must be kept. */
  append?: (file: string) => boolean;
  /** Events of one journal from `state` on; may throw when the file cannot be parsed. */
  read(file: string, state?: string): Promise<UsageLogEvent[] | UsageLogRead>;
}

/** How a native journal source is doing, so an unreadable log is not shown as zero tokens. */
export type UsageSourceStatus = "ok" | "empty" | "unavailable" | "error";

/** One native journal source as the analytics page reports it. */
export interface UsageSource {
  agent: string;
  label: string;
  status: UsageSourceStatus;
  /** Journal files discovered for the agent. */
  files: number;
  /** Usage events in the selected range, from those files. */
  events: number;
  /** Events whose cost the agent recorded itself. */
  recordedEvents: number;
  /** Events with no recorded or computed price. */
  unpricedEvents: number;
  /** When the last successful scan happened, ms since the epoch. */
  lastReadAt: number | null;
  /** Why the source is unavailable or broken, when it is. */
  message?: string;
}

/** Tokens, answers and the cost of the answers that had a price. */
export interface UsageTotals extends UsageTokens {
  /** All four token kinds together. */
  tokens: number;
  answers: number;
  /** Cost in the currency of the model's tariff; only priced answers contribute. */
  cost: number;
  pricedAnswers: number;
  /** Cost the agent wrote into its journal, not an estimate. */
  recordedCost: number;
  /** Cost Projector computed from the model's tariff. */
  computedCost: number;
}

/** One calendar day of the selected range; days without answers stay in the list as zeros. */
export interface UsageDay extends UsageTotals {
  /** `YYYY-MM-DD`, in the server's local time. */
  day: string;
  /** Midnight of that day, ms since the epoch. */
  at: number;
}

/** Totals of one agent, model, project or chat. */
export interface UsageBreakdown extends UsageTotals {
  key: string;
}

/** One recorded look at a limit window. */
export interface LimitPoint {
  /** When the upstream service answered, ms since the epoch. */
  at: number;
  /** Percent of the window already spent, 0–100. */
  used: number;
}

/** How full one limit window is and how fast it fills. */
export interface LimitSeries {
  /** Backend id of the agent the window belongs to (`claude`, `codex`, …). */
  agent: string;
  /** Window id as the adapter names it (`rolling`, `weekly`, `monthly`, `total`, …). */
  window: string;
  /** Samples inside the selected range, oldest first. */
  points: LimitPoint[];
  /** The newest sample, even when it is older than the range. */
  usedPercent: number | null;
  resetsAt: number | null;
  limited: boolean;
  /** Length of a full cycle, when the window name is one of the known cycles. */
  periodSeconds: number | null;
  /** What the elapsed fraction of the cycle says should be spent by now. */
  expectedPercent: number | null;
  /** Where the recorded pace leads by the reset, percent of the window. */
  projectedPercent: number | null;
  /** Recorded growth, percentage points per hour. */
  ratePerHour: number | null;
}

/** One recorded look at a provider's money balance. */
export interface ProviderPoint {
  /** When the provider answered, ms since the epoch. */
  at: number;
  /** Balance in `currency`, as a number. */
  total: number;
}

/** What the provider's balance did over the range: the literal money spent through its API. */
export interface ProviderSpend {
  /** Provider id from `providers.json`. */
  provider: string;
  /** Provider name as the settings show it. */
  label: string;
  /** `USD`, `CNY` or whatever the provider reports. */
  currency: string;
  /** Samples inside the range, oldest first. */
  points: ProviderPoint[];
  /** The newest balance, even when it is older than the range. */
  total: number | null;
  /** Money that left the balance in the range; top-ups are ignored. */
  spent: number;
  /** Money added to the balance in the range. */
  toppedUp: number;
  /** When the newest sample was taken. */
  checkedAt: number | null;
}

/** Everything the analytics page draws in one answer. */
export interface UsageAnalytics {
  /** Requested range in days. */
  days: number;
  /** Start of the range, ms since the epoch. */
  since: number;
  /** When the answer was built, ms since the epoch. */
  until: number;
  totals: UsageTotals;
  daily: UsageDay[];
  byAgent: UsageBreakdown[];
  byModel: UsageBreakdown[];
  byProject: UsageBreakdown[];
  /** Where the tokens went: chat answers plus Projector's service calls (lens, judge, …). */
  byTask: UsageBreakdown[];
  /** Tokens and cost of Projector's service calls, outside chat answers. */
  service: UsageTotals;
  /** Number of Projector service calls in the range, not chat answers. */
  serviceCalls: number;
  limits: LimitSeries[];
  /** Money balances of providers whose API reports them (DeepSeek). */
  providers: ProviderSpend[];
  /** Native journals that contributed or failed; an empty list means no readers are registered. */
  sources: UsageSource[];
}

/** Full cycle lengths: pace compares spent % to elapsed fraction of this maximum. */
export const USAGE_PERIOD_SECONDS = {
  hours5: 5 * 3600,
  week: 7 * 86400,
  month: 30 * 86400,
  rolling: 5 * 3600,
  weekly: 7 * 86400,
  monthly: 30 * 86400,
} as const;

/** Cycle length of a window name; adapters that expose other windows get no pace estimate. */
export function limitPeriodSeconds(window: string): number | null {
  if (window === "rolling") return USAGE_PERIOD_SECONDS.rolling;
  if (window === "weekly") return USAGE_PERIOD_SECONDS.weekly;
  if (window === "monthly") return USAGE_PERIOD_SECONDS.monthly;
  return null;
}

/** Blue spare → gray normal → yellow hot → red over. */
export type UsagePaceTone = "spare" | "normal" | "hot" | "over";

/**
 * Pace of limit spend vs time left until reset.
 * `periodSeconds` is the maximum time-to-reset at cycle start (week/month/5h).
 * Weekly and monthly windows are judged on a day-scale period; rolling uses hours.
 */
export function usagePaceTone(
  usedPercent: number,
  resetsAt: number | null | undefined,
  periodSeconds: number | null | undefined,
  now = Date.now(),
  limited = false,
): UsagePaceTone | null {
  if (!Number.isFinite(usedPercent) || usedPercent < 0) return null;
  if (!Number.isFinite(periodSeconds) || (periodSeconds ?? 0) <= 0) return null;
  if (limited || usedPercent >= 100) return "over";
  if (!resetsAt || !Number.isFinite(resetsAt)) return null;

  const remainingSeconds = Math.max(0, resetsAt - now / 1000);
  const remainingFraction = Math.min(1, remainingSeconds / periodSeconds!);
  const expectedUsed = (1 - remainingFraction) * 100;
  const delta = usedPercent - expectedUsed;

  if (delta <= -15) return "spare";
  if (delta <= 8) return "normal";
  if (delta <= 22) return "hot";
  return "over";
}

/** Expected spend by now, from the window length and its reset time. */
export function expectedUsagePercent(
  periodSeconds: number | null,
  resetsAt: number | null,
  now = Date.now(),
): number | null {
  if (!periodSeconds || !resetsAt) return null;
  const remainingSeconds = Math.max(0, resetsAt - now / 1000);
  return Math.min(100, Math.max(0, (1 - remainingSeconds / periodSeconds) * 100));
}
