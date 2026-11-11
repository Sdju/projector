<script setup lang="ts">
import IconTerminal from "~icons/lucide/terminal";
import {
  USAGE_PERIOD_SECONDS,
  type AgentUsage,
} from "@ai-projector/core/modules/usage-analytics/index.ts";
import UsageIndicator from "../_/UsageIndicator.vue";
import { useAgentUsageIndicator } from "../_/use-agent-usage-indicator.ts";
import type { UsageWindowData } from "../_/usage-windows.ts";

const props = defineProps<{
  usageUrl?: string;
  title?: string;
  agentId?: string;
}>();

type WindowName = "rolling" | "weekly" | "monthly" | "daily" | "default";
const ticks = [25, 50, 75];
const commandId = `ide.plugin.${(props.agentId ?? "agent").replace(/[^a-z0-9._-]/gi, "-")}.usage.window.cycle`;
const { selected, remaining, tone, tooltipRows, tooltip, commands } = useAgentUsageIndicator<
  AgentUsage,
  WindowName
>({
  agent: props.agentId ?? "plugin",
  title: props.title ?? "Агент",
  endpoint: props.usageUrl ?? "",
  definitions: [
    {
      name: "rolling",
      label: "5 часов",
      shortLabel: "5ч",
      periodSeconds: USAGE_PERIOD_SECONDS.hours5,
      ticks,
    },
    {
      name: "weekly",
      label: "Неделя",
      shortLabel: "нед",
      periodSeconds: USAGE_PERIOD_SECONDS.week,
      ticks,
    },
    {
      name: "monthly",
      label: "Месяц",
      shortLabel: "мес",
      periodSeconds: USAGE_PERIOD_SECONDS.month,
      ticks,
    },
    {
      name: "daily",
      label: "День",
      shortLabel: "день",
      periodSeconds: 86400,
      ticks,
    },
    {
      name: "default",
      label: "Лимит",
      shortLabel: "лимит",
      periodSeconds: 0,
      ticks,
    },
  ],
  cycleOrder: ["rolling", "weekly", "monthly", "daily", "default"],
  initial: "default",
  usage: (value) => value,
  windows: (value) =>
    value?.windows as Partial<Record<WindowName, UsageWindowData>> | null | undefined,
  command: {
    id: commandId,
    title: `Переключить отображаемый лимит ${props.title ?? "агента"}`,
    description: "Меняет окно индикатора лимитов плагинного агента, пропуская отсутствующие окна.",
  },
});
</script>

<template>
  <UsageIndicator
    :title="title ?? 'Агент'"
    :tooltip="tooltip"
    :remaining="remaining"
    :tone="tone"
    :prefix="selected.shortLabel"
    :meter-label="`Остаток лимита ${title ?? 'агента'}: ${selected.label}`"
    :rows="tooltipRows"
    interactive
    @cycle="commands.run(commandId)"
  >
    <template #icon><IconTerminal /></template>
  </UsageIndicator>
</template>
