import { pluginBalanceKinds } from "./balance-registry.ts";
import { providerUsageKinds } from "./usage-registry.ts";

/** Виды провайдеров, для которых есть читатели баланса и расхода. */
export function providerReaderKinds() {
  return {
    balanceKinds: pluginBalanceKinds(),
    usageKinds: providerUsageKinds(),
  };
}
