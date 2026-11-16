<script setup lang="ts">
import { computed, useId, watch } from "vue";
import UsageIndicator from "../../_/UsageIndicator.vue";
import { publishProviderBalance } from "../../_/usage-summary.ts";
import { useUsagePolling } from "../../_/use-usage-polling.ts";
import IconWallet from "~icons/lucide/wallet";
import { useCommandScope } from "../../../../common/utilities/commands.ts";
import { formatAmount, formatBalances, useProviders } from "../../../provider/index.ts";
import type { ProviderBalance } from "../../../provider/index.ts";

const { activeProviderId, revision } = useProviders();
const { usage, failed, refresh } = useUsagePolling<{
  wallets: ProviderBalance[];
  checkedAt: number;
}>("/api/providers/balances", {
  nextCheckAt: (value) => value.checkedAt + 60000,
});
// A saved key, a new wallet or a switch of the default only needs a new request.
watch([activeProviderId, revision], () => void refresh());

const wallets = computed(() => usage.value?.wallets ?? []);
const shown = computed(() => wallets.value.some((wallet) => wallet.status !== "unsupported"));
const ready = computed(() => wallets.value.some((wallet) => wallet.status === "ready"));
const text = computed(() => (ready.value ? formatBalances(wallets.value) || "0" : "—"));
const tone = computed(() =>
  wallets.value.some((wallet) => wallet.available === false) ? "over" : "normal",
);
const tooltip = computed(() => {
  const value = wallets.value;
  if (!value.length) return failed.value ? "Баланс кошельков недоступен" : "Баланс кошельков";
  const rows = value.map((wallet) => {
    const name = wallet.providerName ?? "Провайдер";
    if (wallet.status !== "ready") return `${name}: ${wallet.message ?? "—"}`;
    const amounts = wallet.entries
      .map((entry) => {
        const total = formatAmount(entry.currency, entry.total);
        const toppedUp = formatAmount(entry.currency, entry.toppedUp);
        const granted = formatAmount(entry.currency, entry.granted);
        return `${total} (пополнено ${toppedUp}, подарочные ${granted})`;
      })
      .join(" · ");
    return `${name}: ${amounts}`;
  });
  if (value.some((wallet) => wallet.available === false))
    rows.push("Средств недостаточно для вызовов");
  return ["Баланс кошельков", ...rows].join("\n");
});

publishProviderBalance(
  computed(() => (ready.value ? text.value : null)),
  tone,
);

const commands = useCommandScope(`providerBalance:${useId()}`, () => ({ surface: "statusBar" }));
commands.scope.registerCommand({
  id: "ide.providers.balance.show",
  title: "Обновить баланс кошельков",
  description:
    "Заново запрашивает балансы всех включённых провайдеров с известным способом чтения (DeepSeek и виды из плагинов).",
  run: refresh,
});
</script>

<template>
  <UsageIndicator
    v-if="shown || failed"
    class="provider-balance"
    title="Баланс"
    :tooltip="tooltip"
    :remaining="null"
    :value-text="text"
    :tone="tone"
    meter-label="Баланс всех кошельков"
    :rows="[]"
    interactive
    @cycle="commands.run('ide.providers.balance.show')"
  >
    <template #icon><IconWallet /></template>
  </UsageIndicator>
</template>
