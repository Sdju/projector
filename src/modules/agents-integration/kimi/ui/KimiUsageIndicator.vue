<script setup lang="ts">
import { useId } from "vue";
import { useIntervalFn, useNow } from "@vueuse/core";
import UsageIndicator from "../../_/UsageIndicator.vue";
import { useUsageWindows } from "../../_/usage-windows.ts";
import { publishAgentUsage } from "../../_/usage-summary.ts";
import { useUsagePolling } from "../../_/use-usage-polling.ts";
import { USAGE_PERIOD_SECONDS } from "../../_/usage-pace.ts";
import IconKimi from "~icons/simple-icons/kimi";
import type { KimiUsage } from "../../../../../core/modules/agents-integration/kimi/index.ts";
import { useCommandScope } from "../../../../common/utilities/commands.ts";

const { usage, failed } = useUsagePolling<KimiUsage>("/api/kimi/usage");
const now = useNow({ scheduler: (update) => useIntervalFn(update, 1000) });
type WindowName = keyof NonNullable<KimiUsage["windows"]>;
const weekTicks = Array.from({ length: 6 }, (_, day) => ((day + 1) / 7) * 100);
const monthTicks = [7, 14, 21, 28].map((day) => (day / 30) * 100);
const { selectedWindow, selected, remaining, tone, tooltipRows, tooltip, cycle } =
  useUsageWindows<WindowName>({
    title: "Kimi",
    definitions: [
      {
        name: "rolling",
        label: "5 часов",
        shortLabel: "5ч",
        periodSeconds: USAGE_PERIOD_SECONDS.hours5,
        ticks: [20, 40, 60, 80],
      },
      {
        name: "weekly",
        label: "Неделя",
        shortLabel: "нед",
        periodSeconds: USAGE_PERIOD_SECONDS.week,
        ticks: weekTicks,
      },
      {
        name: "monthly",
        label: "Месяц",
        shortLabel: "мес",
        periodSeconds: USAGE_PERIOD_SECONDS.month,
        ticks: monthTicks,
      },
    ],
    cycleOrder: ["rolling", "weekly", "monthly"],
    initial: "weekly",
    usage: () => usage.value,
    windows: () => usage.value?.windows,
    failed: () => failed.value,
    now: () => now.value.getTime(),
  });
const commands = useCommandScope(`kimiUsage:${useId()}`, () => ({
  surface: "statusBar",
  window: selectedWindow.value,
}));
commands.scope.registerCommand({
  id: "ide.kimi.usage.window.cycle",
  title: "Переключить отображаемый лимит Kimi",
  description:
    "Меняет окно индикатора Kimi в статусной строке: 5 часов → неделя → месяц. Не запрашивает лимиты заново.",
  run: cycle,
});
publishAgentUsage("kimi", remaining, tone);
</script>

<template>
  <UsageIndicator
    class="kimi-usage"
    title="Kimi"
    :tooltip="tooltip"
    :remaining="remaining"
    :tone="tone"
    :prefix="selected.shortLabel"
    :meter-label="`Остаток лимита Kimi: ${selected.label}`"
    :rows="tooltipRows"
    interactive
    @cycle="commands.run('ide.kimi.usage.window.cycle')"
  >
    <template #icon><IconKimi /></template>
  </UsageIndicator>
</template>
