import type { ProviderBalance, ProviderBalanceEntry } from "./types.ts";

const SYMBOLS: Record<string, string> = { CNY: "¥", USD: "$" };

/** Rounds a decimal money string to hundredths without binary fractions: "5.205" → "5.21". */
function roundMoney(value: string): string {
  const [whole = "0", fraction = ""] = value.split(".");
  const digits = fraction.padEnd(3, "0");
  let cents = BigInt(`${whole}${digits.slice(0, 2)}`);
  if (Number(digits[2]) >= 5) cents += 1n;
  const text = cents.toString().padStart(3, "0");
  return `${text.slice(0, -2)}.${text.slice(-2)}`;
}

/** "¥110.00 · $5.00": wallet amounts are shown to hundredths of a currency unit. */
export function formatBalance(entries: readonly ProviderBalanceEntry[]): string {
  return entries
    .map(({ currency, total }) => {
      const money = roundMoney(total);
      return SYMBOLS[currency] ? `${SYMBOLS[currency]}${money}` : `${money} ${currency}`;
    })
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
