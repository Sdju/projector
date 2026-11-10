<script setup lang="ts">
import UsageIndicator from "../../_/UsageIndicator.vue";
import { useAgentUsageIndicator } from "../../_/use-agent-usage-indicator.ts";
import { USAGE_PERIOD_SECONDS } from "../../_/usage-pace.ts";
import IconKimi from "~icons/simple-icons/kimi";
import type { KimiUsage } from "@ai-projector/core/modules/agents-integration/kimi/index.ts";

type WindowName = keyof NonNullable<KimiUsage["windows"]>;
const weekTicks = Array.from({ length: 6 }, (_, day) => ((day + 1) / 7) * 100);
const monthTicks = [7, 14, 21, 28].map((day) => (day / 30) * 100);
const { selected, remaining, tone, tooltipRows, tooltip, commands } = useAgentUsageIndicator<
  KimiUsage,
  WindowName
>({
  agent: "kimi",
  title: "Kimi",
  endpoint: "/api/kimi/usage",
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
  initial: "rolling",
  usage: (value) => value,
  windows: (value) => value?.windows,
  command: {
    id: "ide.kimi.usage.window.cycle",
    title: "Переключить отображаемый лимит Kimi",
    description:
      "Меняет окно индикатора Kimi в статусной строке: 5 часов → неделя → месяц, пропуская окна, которых нет на тарифе. Не запрашивает лимиты заново.",
  },
});
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
