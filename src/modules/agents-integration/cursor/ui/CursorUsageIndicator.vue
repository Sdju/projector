<script setup lang="ts">
import { computed, ref, useId } from "vue";
import { useIntervalFn, useNow } from "@vueuse/core";
import UsageMeter from "../../_/UsageMeter.vue";
import { useUsagePolling } from "../../_/use-usage-polling.ts";
import IconCursor from "~icons/simple-icons/cursor";
import type { CursorUsage } from "../../../../../core/modules/agents-integration/cursor/index.ts";
import { useCommandScope } from "../../../../common/utilities/commands.ts";
import { resetCountdown, resetTimestamp } from "../../../../common/utilities/reset-time.ts";

const { usage, failed } = useUsagePolling<CursorUsage>("/api/cursor/usage");
const now = useNow({ scheduler: (update) => useIntervalFn(update, 1000) });
type WindowName = keyof NonNullable<CursorUsage["windows"]>;
const windowOrder: WindowName[] = ["total", "auto", "api"];
const labels = { total: "Всего", auto: "Авто", api: "API" };
const shortLabels = { total: "вс", auto: "авт", api: "API" };
const selectedWindow = ref<WindowName>("total");
const commands = useCommandScope(`cursorUsage:${useId()}`, () => ({
  surface: "statusBar", window: selectedWindow.value,
}));
commands.scope.registerCommand({
  id: "ide.cursor.usage.window.cycle",
  title: "Переключить отображаемый лимит Cursor",
  description:
    "Меняет окно индикатора Cursor в статусной строке: всего → авто → API. Не запрашивает лимиты заново.",
  run: () => {
    selectedWindow.value = windowOrder[(windowOrder.indexOf(selectedWindow.value) + 1) % windowOrder.length]!;
    return { window: selectedWindow.value };
  },
});
const remaining = computed(() => {
  if (failed.value || usage.value?.status !== "ready" || !usage.value.windows) return null;
  return Math.round(100 - usage.value.windows[selectedWindow.value].usedPercent);
});
const tooltipRows = computed(() => {
  if (failed.value || usage.value?.status !== "ready" || !usage.value.windows) return [];
  const windows = usage.value.windows;
  return (Object.keys(shortLabels) as WindowName[]).map((name) => ({
    name, label: shortLabels[name], remaining: Math.round(100 - windows[name].usedPercent),
    countdown: resetCountdown(windows[name].resetsAt, now.value.getTime()),
    limited: windows[name].limited,
  }));
});
const tooltip = computed(() => {
  const heading = `Cursor · ${labels[selectedWindow.value]}`;
  if (failed.value) return `${heading}\nНе удалось обновить лимиты`;
  if (!usage.value) return `${heading}\nЗагрузка лимитов…`;
  const windows = usage.value.windows;
  if (remaining.value === null || !windows)
    return `${heading}\n${usage.value.message ?? "Лимиты недоступны"}`;
  return [`${heading} · остаток`, ...Object.entries(labels).map(([name, label]) => {
    const window = windows[name as keyof typeof windows];
    const reset = resetCountdown(window.resetsAt, now.value.getTime());
    return `${label}: ${Math.round(100 - window.usedPercent)}%${window.limited ? " · исчерпан" : ""} · ${reset} (${resetTimestamp(window.resetsAt)})`;
  }), "Клик — сменить лимит"].join("\n");
});
</script>

<template>
  <button
    type="button"
    class="cursor-usage"
    :aria-label="tooltip"
    @click="commands.run('ide.cursor.usage.window.cycle')"
  >
    <IconCursor class="cursor-icon" aria-hidden="true" />
    <UsageMeter
      :remaining="remaining"
      :prefix="shortLabels[selectedWindow]"
      :aria-label="`Остаток лимита Cursor: ${labels[selectedWindow]}`"
    />
    <span class="quota-tooltip" role="tooltip">
      <template v-if="tooltipRows.length">
        <span class="tooltip-heading">Cursor · сброс через</span>
        <span v-for="row in tooltipRows" :key="row.name" class="quota-row">
          <span>{{ row.label }}</span>
          <UsageMeter
            :remaining="row.remaining"
            :countdown="row.countdown"
            :exhausted="row.limited"
          />
        </span>
        <span class="tooltip-hint">Клик — сменить лимит</span>
      </template>
      <template v-else>{{ tooltip }}</template>
    </span>
  </button>
</template>

<style scoped>
.cursor-usage {
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
.cursor-icon {
  width: 13px;
  height: 13px;
}
.tooltip-heading { display: block; margin-bottom: 5px; }
.quota-row {
  display: grid;
  grid-template-columns: 26px 160px;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.tooltip-hint { display: block; margin-top: 5px; color: var(--muted); }
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
.cursor-usage:hover .quota-tooltip,
.cursor-usage:focus-visible .quota-tooltip {
  opacity: 1;
  visibility: visible;
}
</style>
