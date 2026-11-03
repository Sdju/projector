<script setup lang="ts">
import { computed, useId, watch } from "vue";
import UsageIndicator from "../../_/UsageIndicator.vue";
import { publishProviderBalance } from "../../_/usage-summary.ts";
import { useUsagePolling } from "../../_/use-usage-polling.ts";
import IconWallet from "~icons/lucide/wallet";
import { useCommandScope } from "../../../../common/utilities/commands.ts";
import { formatBalance, useProviders } from "../../../provider/index.ts";
import type { ProviderBalance } from "../../../provider/index.ts";

const { activeProviderId, revision } = useProviders();
const { usage, failed, refresh } = useUsagePolling<ProviderBalance>("/api/providers/balance", {
  nextCheckAt: (value) => value.checkedAt + 60000,
});
// The server resolves the active provider, so a switch or a saved key only needs a new request.
watch([activeProviderId, revision], () => void refresh());

const shown = computed(() => usage.value && usage.value.status !== "unsupported");
const ready = computed(() => usage.value?.status === "ready");
const text = computed(() =>
  usage.value && ready.value ? formatBalance(usage.value.entries) || "0" : "—",
);
const tone = computed(() => (usage.value?.available === false ? "over" : "normal"));
const tooltip = computed(() => {
  const value = usage.value;
  if (!value || !ready.value)
    return value?.message ?? (failed.value ? "Баланс провайдера недоступен" : "Баланс провайдера");
  const rows = value.entries.map(
    (entry) =>
      `${entry.currency}: ${entry.total} (пополнено ${entry.toppedUp}, подарочные ${entry.granted})`,
  );
  if (value.available === false) rows.push("Средств недостаточно для вызовов");
  return ["Баланс провайдера", ...rows].join("\n");
});

publishProviderBalance(
  computed(() => (ready.value && usage.value ? text.value : null)),
  tone,
);

const commands = useCommandScope(`providerBalance:${useId()}`, () => ({ surface: "statusBar" }));
commands.scope.registerCommand({
  id: "ide.providers.balance.show",
  title: "Обновить баланс активного провайдера",
  description:
    "Заново запрашивает баланс активного провайдера для индикатора в статусной строке (сейчас только DeepSeek).",
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
    meter-label="Баланс активного провайдера"
    :rows="[]"
    interactive
    @cycle="commands.run('ide.providers.balance.show')"
  >
    <template #icon><IconWallet /></template>
  </UsageIndicator>
</template>
