import type { ProviderBalanceEntry } from "./types.ts";

const SYMBOLS: Record<string, string> = { CNY: "¥", USD: "$" };

/** "¥110.00 · $5.00": amounts keep the digits the provider returned. */
export function formatBalance(entries: readonly ProviderBalanceEntry[]): string {
  return entries
    .map(({ currency, total }) =>
      SYMBOLS[currency] ? `${SYMBOLS[currency]}${total}` : `${total} ${currency}`,
    )
    .join(" · ");
}

export function formatAmount(currency: string, value: string): string {
  return formatBalance([{ currency, total: value, granted: "", toppedUp: "" }]);
}
