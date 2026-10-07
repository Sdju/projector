<script setup lang="ts">
import { computed } from "vue";
import { useIntervalFn, useNow } from "@vueuse/core";
import UsageIndicator from "../../_/UsageIndicator.vue";
import { usageWindowView } from "../../_/usage-windows.ts";
import { publishAgentUsage } from "../../_/usage-summary.ts";
import { useUsagePolling } from "../../_/use-usage-polling.ts";
import { USAGE_PERIOD_SECONDS } from "../../_/usage-pace.ts";
import IconCodex from "~icons/simple-icons/openai";
import type { CodexUsage } from "../../../../../core/modules/agents-integration/codex/index.ts";
import { resetTimestamp } from "../../../../common/utilities/reset-time.ts";

const { usage, failed } = useUsagePolling<CodexUsage>("/api/codex/usage");
const now = useNow({ scheduler: (update) => useIntervalFn(update, 1000) });
const weekly = computed(() => usage.value?.weekly ?? null);
const periodSeconds = computed(() => {
  const mins = weekly.value?.windowDurationMins;
  return typeof mins === "number" && Number.isFinite(mins) && mins > 0
    ? mins * 60
    : USAGE_PERIOD_SECONDS.week;
});
const current = computed(() => {
  if (failed.value || usage.value?.status !== "ready" || !weekly.value) return null;
  return usageWindowView(
    {
      name: "weekly",
      label: "Неделя",
      shortLabel: "нед",
      periodSeconds: periodSeconds.value,
      ticks: Array.from({ length: 6 }, (_, day) => ((day + 1) / 7) * 100),
    },
    weekly.value,
    now.value.getTime(),
  );
});
const remaining = computed(() => current.value?.remaining ?? null);
const tone = computed(() => current.value?.tone ?? null);
const tooltipRows = computed(() => (current.value ? [current.value] : []));
publishAgentUsage("codex", remaining, tone);
const tooltip = computed(() => {
  if (failed.value) return "Codex: не удалось обновить недельный лимит";
  if (!usage.value) return "Codex: загрузка недельного лимита…";
  if (remaining.value === null) return `Codex: ${usage.value.message ?? "лимит недоступен"}`;
  const reset = weekly.value?.resetsAt;
  return `Codex · неделя · осталось ${remaining.value}%\nСброс через ${current.value?.countdown} · ${resetTimestamp(reset)}`;
});
</script>

<template>
  <UsageIndicator
    class="codex-usage"
    title="Codex"
    :tooltip="tooltip"
    :remaining="remaining"
    :tone="tone"
    meter-label="Остаток недельного лимита Codex"
    :rows="tooltipRows"
    compact
  >
    <template #icon><IconCodex /></template>
  </UsageIndicator>
</template>
