<script setup lang="ts">
import UsageIndicator from "../../_/UsageIndicator.vue";
import { useAgentUsageIndicator } from "../../_/use-agent-usage-indicator.ts";
import { USAGE_PERIOD_SECONDS } from "../../_/usage-pace.ts";
import IconCursor from "~icons/simple-icons/cursor";
import type { CursorUsage } from "@ai-projector/core/modules/agents-integration/cursor/index.ts";

type WindowName = keyof NonNullable<CursorUsage["windows"]>;
const monthTicks = [7, 14, 21, 28].map((day) => (day / 30) * 100);
const { selected, remaining, tone, tooltipRows, tooltip, commands } = useAgentUsageIndicator<
  CursorUsage,
  WindowName
>({
  agent: "cursor",
  title: "Cursor",
  endpoint: "/api/cursor/usage",
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
  usage: (value) => value,
  windows: (value) => value?.windows,
  command: {
    id: "ide.cursor.usage.window.cycle",
    title: "Переключить отображаемый лимит Cursor",
    description:
      "Меняет окно индикатора Cursor в статусной строке: всего → авто → API. Не запрашивает лимиты заново.",
  },
});
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
