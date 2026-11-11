<script setup lang="ts">
import type { Component } from "vue";
import IconTerminal from "~icons/lucide/terminal";
import {
  USAGE_PERIOD_SECONDS,
  type AgentUsage,
  type AgentUsageWindowDefinition,
} from "@ai-projector/core/modules/usage-analytics/index.ts";
import UsageIndicator from "../_/UsageIndicator.vue";
import { useAgentUsageIndicator } from "../_/use-agent-usage-indicator.ts";
import type { UsageWindowData, UsageWindowDefinition } from "../_/usage-windows.ts";

const props = defineProps<{
  usageUrl?: string;
  title?: string;
  agentId?: string;
  /** A plugin-provided icon; the shared indicator falls back to a terminal. */
  icon?: Component;
  /** Windows the plugin labels itself; absent uses the generic subscription windows. */
  windows?: readonly AgentUsageWindowDefinition[];
}>();

const ticks = [25, 50, 75];
const fallbackDefinitions: readonly UsageWindowDefinition[] = [
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
];
const definitions = props.windows?.length
  ? props.windows.map((window): UsageWindowDefinition => ({
      name: window.name,
      label: window.label,
      shortLabel: window.shortLabel,
      periodSeconds: window.periodSeconds,
      ticks: window.ticks?.length ? window.ticks : ticks,
    }))
  : fallbackDefinitions;
const commandId = `ide.plugin.${(props.agentId ?? "agent").replace(/[^a-z0-9._-]/gi, "-")}.usage.window.cycle`;
const { selected, remaining, tone, tooltipRows, tooltip, commands } = useAgentUsageIndicator<
  AgentUsage,
  string
>({
  agent: props.agentId ?? "plugin",
  title: props.title ?? "Агент",
  endpoint: props.usageUrl ?? "",
  definitions,
  cycleOrder: definitions.map((definition) => definition.name),
  initial: definitions[0]!.name,
  usage: (value) => value,
  windows: (value) => value?.windows as Partial<Record<string, UsageWindowData>> | null | undefined,
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
    <template #icon><component :is="icon ?? IconTerminal" /></template>
  </UsageIndicator>
</template>
