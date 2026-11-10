import {
  modelCost,
  modelTokens,
  type ModelPrice,
  type ModelUsage,
  type UsageBreakdown,
  type UsageTotals,
} from "@ai-projector/core/modules/usage-analytics/index.ts";
import { addTaskSample, readTaskSamples, type StoredTaskSample } from "./store.ts";

const emptyTotals = (): UsageTotals => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  tokens: 0,
  answers: 0,
  cost: 0,
  pricedAnswers: 0,
  recordedCost: 0,
  computedCost: 0,
});

/**
 * Remembers one of Projector's own short model calls — Lens, Judge, the doctors, a compaction or
 * a command review. The chat answers already live in the history; this is the money beside them.
 */
export function recordTaskSpend(
  task: string,
  usage: ModelUsage | undefined,
  price?: ModelPrice,
  meta: { provider?: string; model?: string } = {},
): void {
  try {
    const tokens = modelTokens(usage);
    const total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
    if (!total) return;
    addTaskSample({
      minute: Date.now(),
      task,
      provider: meta.provider ?? "",
      model: meta.model ?? "",
      ...tokens,
      cost: price ? modelCost(tokens, price) : 0,
      priced: Boolean(price),
    });
  } catch {
    // A chart is not worth failing the call it was recorded from.
  }
}

/** Adds one minute bucket to totals. */
function addSample(totals: UsageTotals, sample: StoredTaskSample): void {
  totals.input += sample.input;
  totals.output += sample.output;
  totals.cacheRead += sample.cacheRead;
  totals.cacheWrite += sample.cacheWrite;
  totals.tokens += sample.input + sample.output + sample.cacheRead + sample.cacheWrite;
  totals.answers += sample.calls;
  totals.cost += sample.cost;
  totals.pricedAnswers += sample.pricedCalls;
  totals.computedCost += sample.cost;
}

export interface TaskSpendResult {
  totals: UsageTotals;
  byTask: UsageBreakdown[];
  /** Number of service calls, not chat answers. */
  calls: number;
  /** Raw minute buckets, so a caller can add the same spend to its own chart. */
  samples: StoredTaskSample[];
}

/** What the service calls spent in the range, by task; chat answers are added by the caller. */
export function taskSpend(since: number): TaskSpendResult {
  const samples = readTaskSamples(since);
  const totals = emptyTotals();
  const groups = new Map<string, UsageBreakdown>();
  let calls = 0;
  for (const sample of samples) {
    addSample(totals, sample);
    calls += sample.calls;
    const group = groups.get(sample.task);
    if (group) addSample(group, sample);
    else groups.set(sample.task, bucketOf(sample));
  }
  return {
    totals,
    byTask: [...groups.values()].sort((a, b) => b.tokens - a.tokens),
    calls,
    samples,
  };
}

function bucketOf(sample: StoredTaskSample): UsageBreakdown {
  return {
    key: sample.task,
    input: sample.input,
    output: sample.output,
    cacheRead: sample.cacheRead,
    cacheWrite: sample.cacheWrite,
    tokens: sample.input + sample.output + sample.cacheRead + sample.cacheWrite,
    answers: sample.calls,
    cost: sample.cost,
    pricedAnswers: sample.pricedCalls,
    recordedCost: 0,
    computedCost: sample.cost,
  };
}
