<script setup lang="ts">
import { computed } from "vue";
import { useIntervalFn, useNow } from "@vueuse/core";
import UsageMeter from "../../_/UsageMeter.vue";
import { publishAgentUsage } from "../../_/usage-summary.ts";
import { useUsagePolling } from "../../_/use-usage-polling.ts";
import { USAGE_PERIOD_SECONDS, usagePaceTone } from "../../_/usage-pace.ts";
import IconCodex from "~icons/simple-icons/openai";
import type { CodexUsage } from "../../../../../core/modules/agents-integration/codex/index.ts";
import { resetCountdown, resetTimestamp } from "../../../../common/utilities/reset-time.ts";

const { usage, failed } = useUsagePolling<CodexUsage>("/api/codex/usage");
const now = useNow({ scheduler: (update) => useIntervalFn(update, 1000) });
const weekly = computed(() => usage.value?.weekly ?? null);
const remaining = computed(() => {
  if (failed.value || usage.value?.status !== "ready" || !weekly.value) return null;
  return Math.round(100 - weekly.value.usedPercent);
});
const periodSeconds = computed(() => {
  const mins = weekly.value?.windowDurationMins;
  return typeof mins === "number" && Number.isFinite(mins) && mins > 0
    ? mins * 60
    : USAGE_PERIOD_SECONDS.week;
});
const tone = computed(() => {
  if (failed.value || usage.value?.status !== "ready" || !weekly.value) return null;
  return usagePaceTone(
    weekly.value.usedPercent,
    weekly.value.resetsAt,
    periodSeconds.value,
    now.value.getTime(),
  );
});
publishAgentUsage("codex", remaining, tone);
const countdown = computed(() => resetCountdown(weekly.value?.resetsAt, now.value.getTime()));
const tooltip = computed(() => {
  if (failed.value) return "Codex: не удалось обновить недельный лимит";
  if (!usage.value) return "Codex: загрузка недельного лимита…";
  if (remaining.value === null) return `Codex: ${usage.value.message ?? "лимит недоступен"}`;
  const reset = weekly.value?.resetsAt;
  return `Codex · неделя · осталось ${remaining.value}%\nСброс через ${countdown.value} · ${resetTimestamp(reset)}`;
});
</script>

<template>
  <span
    class="codex-usage"
    :class="tone ? `tone-${tone}` : undefined"
    :aria-label="tooltip"
    tabindex="0"
  >
    <IconCodex class="codex-icon" aria-hidden="true" />
    <UsageMeter
      :remaining="remaining"
      compact
      :tone="tone"
      aria-label="Остаток недельного лимита Codex"
    />
    <span class="quota-tooltip" role="tooltip">
      <template v-if="remaining !== null">
        <span class="tooltip-heading">Codex · сброс через</span>
        <span class="quota-row">
          <span>нед</span>
          <UsageMeter
            :remaining="remaining"
            :countdown="countdown"
            :ticks="Array.from({ length: 6 }, (_, day) => ((day + 1) / 7) * 100)"
            :tone="tone"
          />
        </span>
      </template>
      <template v-else>{{ tooltip }}</template>
    </span>
  </span>
</template>

<style scoped>
.codex-usage {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  outline-offset: 2px;
}
.tone-spare {
  color: var(--info);
}
.tone-normal {
  color: var(--muted);
}
.tone-hot {
  color: var(--warn);
}
.tone-over {
  color: var(--err);
}
.codex-icon {
  width: 13px;
  height: 13px;
}
.tooltip-heading {
  display: block;
  margin-bottom: 5px;
}
.quota-row {
  display: grid;
  grid-template-columns: 26px 160px;
  align-items: center;
  gap: 6px;
}
.quota-tooltip {
  position: absolute;
  z-index: 30;
  right: 0;
  bottom: calc(100% + 7px);
  padding: 7px 9px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--bg-raised, var(--bg));
  color: var(--text);
  white-space: pre-line;
  width: max-content;
  max-width: min(340px, 80vw);
  box-shadow: 0 3px 12px #0002;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}
.codex-usage:hover .quota-tooltip,
.codex-usage:focus-visible .quota-tooltip {
  opacity: 1;
  visibility: visible;
}
</style>
