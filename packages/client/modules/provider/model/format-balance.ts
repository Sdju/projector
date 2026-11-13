import type { ProviderBalance, ProviderBalanceEntry } from "./types.ts";

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

/** Adds two non-negative decimal strings without turning money into binary fractions. */
function addDecimal(left: string, right: string): string {
  const [leftInteger, leftFraction = ""] = left.split(".");
  const [rightInteger, rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const leftWhole = BigInt(`${leftInteger}${leftFraction.padEnd(scale, "0")}`);
  const rightWhole = BigInt(`${rightInteger}${rightFraction.padEnd(scale, "0")}`);
  const sum = (leftWhole + rightWhole).toString().padStart(scale + 1, "0");
  return scale ? `${sum.slice(0, -scale)}.${sum.slice(-scale)}` : sum;
}

/** One entry per currency: the combined wallet across every provider that reported a balance. */
export function combineBalances(wallets: readonly ProviderBalance[]): ProviderBalanceEntry[] {
  const totals = new Map<string, ProviderBalanceEntry>();
  for (const wallet of wallets) {
    if (wallet.status !== "ready") continue;
    for (const entry of wallet.entries) {
      const current = totals.get(entry.currency);
      if (!current) {
        totals.set(entry.currency, { ...entry });
        continue;
      }
      totals.set(entry.currency, {
        currency: entry.currency,
        total: addDecimal(current.total, entry.total),
        granted: addDecimal(current.granted, entry.granted),
        toppedUp: addDecimal(current.toppedUp, entry.toppedUp),
      });
    }
  }
  return [...totals.values()];
}

/** The status-bar text: "$42.10 · ¥110.00" for every wallet with a ready balance. */
export function formatBalances(wallets: readonly ProviderBalance[]): string {
  return formatBalance(combineBalances(wallets));
}
