<script setup lang="ts">
import { useId } from "vue";
import { useIntervalFn, useNow } from "@vueuse/core";
import UsageIndicator from "../../_/UsageIndicator.vue";
import { useUsageWindows } from "../../_/usage-windows.ts";
import { publishAgentUsage } from "../../_/usage-summary.ts";
import { useUsagePolling } from "../../_/use-usage-polling.ts";
import { USAGE_PERIOD_SECONDS } from "../../_/usage-pace.ts";
import IconCursor from "~icons/simple-icons/cursor";
import type { CursorUsage } from "../../../../../core/modules/agents-integration/cursor/index.ts";
import { useCommandScope } from "../../../../common/utilities/commands.ts";

const { usage, failed } = useUsagePolling<CursorUsage>("/api/cursor/usage");
const now = useNow({ scheduler: (update) => useIntervalFn(update, 1000) });
type WindowName = keyof NonNullable<CursorUsage["windows"]>;
const monthTicks = [7, 14, 21, 28].map((day) => (day / 30) * 100);
const { selectedWindow, selected, remaining, tone, tooltipRows, tooltip, cycle } =
  useUsageWindows<WindowName>({
    title: "Cursor",
    definitions: [
      {
        name: "total",
        label: "Всего",
        shortLabel: "вс",
        periodSeconds: USAGE_PERIOD_SECONDS.month,
        ticks: monthTicks,
      },
      {
        name: "auto",
        label: "Авто",
        shortLabel: "авт",
        periodSeconds: USAGE_PERIOD_SECONDS.month,
        ticks: monthTicks,
      },
      {
        name: "api",
        label: "API",
        shortLabel: "API",
        periodSeconds: USAGE_PERIOD_SECONDS.month,
        ticks: monthTicks,
      },
    ],
    cycleOrder: ["total", "auto", "api"],
    initial: "total",
    usage: () => usage.value,
    windows: () => usage.value?.windows,
    failed: () => failed.value,
    now: () => now.value.getTime(),
  });
const commands = useCommandScope(`cursorUsage:${useId()}`, () => ({
  surface: "statusBar",
  window: selectedWindow.value,
}));
commands.scope.registerCommand({
  id: "ide.cursor.usage.window.cycle",
  title: "Переключить отображаемый лимит Cursor",
  description:
    "Меняет окно индикатора Cursor в статусной строке: всего → авто → API. Не запрашивает лимиты заново.",
  run: cycle,
});
publishAgentUsage("cursor", remaining, tone);
</script>

<template>
  <UsageIndicator
    class="cursor-usage"
    title="Cursor"
    :tooltip="tooltip"
    :remaining="remaining"
    :tone="tone"
    :prefix="selected.shortLabel"
    :meter-label="`Остаток лимита Cursor: ${selected.label}`"
    :rows="tooltipRows"
    interactive
    @cycle="commands.run('ide.cursor.usage.window.cycle')"
  >
    <template #icon><IconCursor /></template>
  </UsageIndicator>
</template>
