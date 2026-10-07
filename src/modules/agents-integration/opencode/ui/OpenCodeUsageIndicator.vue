<script setup lang="ts">
import { computed, ref, useId } from "vue";
import { useIntervalFn, useNow } from "@vueuse/core";
import UsageMeter from "../../_/UsageMeter.vue";
import { publishAgentUsage } from "../../_/usage-summary.ts";
import { useUsagePolling } from "../../_/use-usage-polling.ts";
import { USAGE_PERIOD_SECONDS, usagePaceTone } from "../../_/usage-pace.ts";
import IconOpenCode from "~icons/simple-icons/opencode";
import type { OpenCodeUsage } from "../../../../../core/modules/agents-integration/opencode/index.ts";
import { useCommandScope } from "../../../../common/utilities/commands.ts";
import { resetCountdown, resetTimestamp } from "../../../../common/utilities/reset-time.ts";

const { usage, failed } = useUsagePolling<OpenCodeUsage>("/api/opencode/usage");
const now = useNow({ scheduler: (update) => useIntervalFn(update, 1000) });
type WindowName = keyof NonNullable<OpenCodeUsage["windows"]>;
const windowOrder: WindowName[] = ["monthly", "rolling", "weekly"];
const labels = { rolling: "5 часов", weekly: "Неделя", monthly: "Месяц" };
const shortLabels = { rolling: "5ч", weekly: "нед", monthly: "мес" };
const periods = {
  rolling: USAGE_PERIOD_SECONDS.hours5,
  weekly: USAGE_PERIOD_SECONDS.week,
  monthly: USAGE_PERIOD_SECONDS.month,
};
const tickPositions = {
  rolling: [20, 40, 60, 80],
  weekly: Array.from({ length: 6 }, (_, day) => ((day + 1) / 7) * 100),
  // Monthly scale is approximately 30 days: one mark per seven days.
  monthly: [7, 14, 21, 28].map((day) => (day / 30) * 100),
};
const selectedWindow = ref<WindowName>("weekly");
const commands = useCommandScope(`opencodeUsage:${useId()}`, () => ({
  surface: "statusBar",
  window: selectedWindow.value,
}));
commands.scope.registerCommand({
  id: "ide.opencode.usage.window.cycle",
  title: "Переключить отображаемый лимит OpenCode Go",
  description:
    "Меняет окно индикатора Go в статусной строке: месяц → 5 часов → неделя. Не запрашивает лимиты заново.",
  run: () => {
    selectedWindow.value =
      windowOrder[(windowOrder.indexOf(selectedWindow.value) + 1) % windowOrder.length]!;
    return { window: selectedWindow.value };
  },
});
const remaining = computed(() => {
  if (failed.value || usage.value?.status !== "ready" || !usage.value.windows) return null;
  return Math.round(100 - usage.value.windows[selectedWindow.value].usedPercent);
});
const selectedTone = computed(() => {
  const window = usage.value?.windows?.[selectedWindow.value];
  if (failed.value || usage.value?.status !== "ready" || !window) return null;
  return usagePaceTone(
    window.usedPercent,
    window.resetsAt,
    periods[selectedWindow.value],
    now.value.getTime(),
    window.limited,
  );
});
publishAgentUsage("opencode", remaining, selectedTone);
const tooltipRows = computed(() => {
  if (failed.value || usage.value?.status !== "ready" || !usage.value.windows) return [];
  const windows = usage.value.windows;
  const at = now.value.getTime();
  return (Object.keys(shortLabels) as WindowName[]).map((name) => ({
    name,
    label: shortLabels[name],
    remaining: Math.round(100 - windows[name].usedPercent),
    countdown: resetCountdown(windows[name].resetsAt, at),
    limited: windows[name].limited,
    tone: usagePaceTone(
      windows[name].usedPercent,
      windows[name].resetsAt,
      periods[name],
      at,
      windows[name].limited,
    ),
  }));
});
const tooltip = computed(() => {
  const heading = `OpenCode Go · ${labels[selectedWindow.value]}`;
  if (failed.value) return `${heading}\nНе удалось обновить лимиты`;
  if (!usage.value) return `${heading}\nЗагрузка лимитов…`;
  const windows = usage.value.windows;
  if (remaining.value === null || !windows)
    return `${heading}\n${usage.value.message ?? "Лимиты недоступны"}`;
  return [
    `${heading} · остаток`,
    ...Object.entries(labels).map(([name, label]) => {
      const window = windows[name as keyof typeof windows];
      const reset = resetCountdown(window.resetsAt, now.value.getTime());
      return `${label}: ${Math.round(100 - window.usedPercent)}%${window.limited ? " · исчерпан" : ""} · ${reset} (${resetTimestamp(window.resetsAt)})`;
    }),
    "Клик — сменить лимит",
  ].join("\n");
});
</script>

<template>
  <button
    type="button"
    class="opencode-usage"
    :class="selectedTone ? `tone-${selectedTone}` : undefined"
    :aria-label="tooltip"
    @click="commands.run('ide.opencode.usage.window.cycle')"
  >
    <IconOpenCode class="opencode-icon" aria-hidden="true" />
    <UsageMeter
      :remaining="remaining"
      :prefix="shortLabels[selectedWindow]"
      :tone="selectedTone"
      :aria-label="`Остаток лимита OpenCode Go: ${labels[selectedWindow]}`"
    />
    <span class="quota-tooltip" role="tooltip">
      <template v-if="tooltipRows.length">
        <span class="tooltip-heading">OpenCode Go · сброс через</span>
        <span v-for="row in tooltipRows" :key="row.name" class="quota-row">
          <span>{{ row.label }}</span>
          <UsageMeter
            :remaining="row.remaining"
            :countdown="row.countdown"
            :exhausted="row.limited"
            :ticks="tickPositions[row.name]"
            :tone="row.tone"
          />
        </span>
        <span class="tooltip-hint">Клик — сменить лимит</span>
      </template>
      <template v-else>{{ tooltip }}</template>
    </span>
  </button>
</template>

<style scoped>
.opencode-usage {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  outline-offset: 2px;
  min-height: 24px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
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
.opencode-icon {
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
  margin-bottom: 4px;
}
.tooltip-hint {
  display: block;
  margin-top: 5px;
  color: var(--muted);
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
  overflow-wrap: anywhere;
  width: max-content;
  max-width: min(340px, 80vw);
  box-shadow: 0 3px 12px #0002;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}
.opencode-usage:hover .quota-tooltip,
.opencode-usage:focus-visible .quota-tooltip {
  opacity: 1;
  visibility: visible;
}
</style>
