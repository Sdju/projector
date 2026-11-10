<script setup lang="ts">
import UsageIndicator from "../../_/UsageIndicator.vue";
import { useAgentUsageIndicator } from "../../_/use-agent-usage-indicator.ts";
import { USAGE_PERIOD_SECONDS } from "../../_/usage-pace.ts";
import IconClaude from "~icons/simple-icons/claude";
import type { ClaudeUsage } from "@projector-ai/core/modules/agents-integration/claude/index.ts";

type WindowName = keyof NonNullable<ClaudeUsage["windows"]>;
const weekTicks = Array.from({ length: 6 }, (_, day) => ((day + 1) / 7) * 100);
const { selected, remaining, tone, tooltipRows, tooltip, commands } = useAgentUsageIndicator<
  ClaudeUsage,
  WindowName
>({
  agent: "claude",
  title: "Claude Code",
  endpoint: "/api/claude/usage",
  polling: { intervalMs: 300000, nextCheckAt: (value) => value.nextCheckAt },
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
  ],
  cycleOrder: ["rolling", "weekly"],
  initial: "weekly",
  usage: (value) => value,
  windows: (value) => value?.windows,
  command: {
    id: "ide.claude.usage.window.cycle",
    title: "Переключить отображаемый лимит Claude Code",
    description:
      "Меняет окно индикатора Claude Code в статусной строке: 5 часов → неделя. Не запрашивает лимиты заново.",
  },
});
</script>

<template>
  <UsageIndicator
    class="claude-usage"
    title="Claude Code"
    :tooltip="tooltip"
    :remaining="remaining"
    :tone="tone"
    :prefix="selected.shortLabel"
    :meter-label="`Остаток лимита Claude Code: ${selected.label}`"
    :rows="tooltipRows"
    interactive
    @cycle="commands.run('ide.claude.usage.window.cycle')"
  >
    <template #icon><IconClaude /></template>
  </UsageIndicator>
</template>
