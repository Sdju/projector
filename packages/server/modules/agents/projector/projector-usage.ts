import {
  modelCost,
  modelTokens,
  type ModelPrice,
  type ModelUsage,
  type UsageTokens,
} from "@ai-projector/core/modules/usage-analytics/index.ts";
import { recordTaskSpend } from "../../spend/index.ts";

/** Token counts of one model request as the SDK reports them. */
export type SdkUsage = ModelUsage;

export type Tokens = UsageTokens;

/** What a million tokens cost; the cache prices default to the price of an ordinary input token. */
export type Price = ModelPrice;

/**
 * How full the window is after a turn. Every step sends the conversation again, and cached
 * tokens already sit inside that step's `inputTokens`, so only the last request counts:
 * its whole prompt plus the answer it just wrote.
 */
export function contextOf(steps: readonly SdkUsage[]): number {
  const last = steps.at(-1);
  return (last?.inputTokens ?? 0) + (last?.outputTokens ?? 0);
}

/** `input` counts the prompt tokens the cache did not serve, as in the usage tooltip of the chat. */
export const tokensOf = modelTokens;

/** The cost of the tokens at the model's price, in the currency of its tariff. */
export const costOf = modelCost;

/** A recorder for one service task with the model that actually answered it. */
export function taskSpendRecorder(
  task: string,
  price?: Price,
  provider = "",
  model = "",
): (usage: SdkUsage | undefined) => void {
  return (usage) => recordTaskSpend(task, usage, price, { provider, model });
}
