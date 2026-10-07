<script setup lang="ts">
import { useId } from "vue";
import { useIntervalFn, useNow } from "@vueuse/core";
import UsageIndicator from "../../_/UsageIndicator.vue";
import { useUsageWindows } from "../../_/usage-windows.ts";
import { publishAgentUsage } from "../../_/usage-summary.ts";
import { useUsagePolling } from "../../_/use-usage-polling.ts";
import { USAGE_PERIOD_SECONDS } from "../../_/usage-pace.ts";
import IconClaude from "~icons/simple-icons/claude";
import type { ClaudeUsage } from "../../../../../core/modules/agents-integration/claude/index.ts";
import { useCommandScope } from "../../../../common/utilities/commands.ts";

const { usage, failed } = useUsagePolling<ClaudeUsage>("/api/claude/usage", {
  intervalMs: 300000,
  nextCheckAt: (value) => value.nextCheckAt,
});
const now = useNow({ scheduler: (update) => useIntervalFn(update, 1000) });
type WindowName = keyof NonNullable<ClaudeUsage["windows"]>;
const weekTicks = Array.from({ length: 6 }, (_, day) => ((day + 1) / 7) * 100);
const { selectedWindow, selected, remaining, tone, tooltipRows, tooltip, cycle } =
  useUsageWindows<WindowName>({
    title: "Claude Code",
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
    usage: () => usage.value,
    windows: () => usage.value?.windows,
    failed: () => failed.value,
    now: () => now.value.getTime(),
  });
const commands = useCommandScope(`claudeUsage:${useId()}`, () => ({
  surface: "statusBar",
  window: selectedWindow.value,
}));
commands.scope.registerCommand({
  id: "ide.claude.usage.window.cycle",
  title: "Переключить отображаемый лимит Claude Code",
  description:
    "Меняет окно индикатора Claude Code в статусной строке: 5 часов → неделя. Не запрашивает лимиты заново.",
  run: cycle,
});
publishAgentUsage("claude", remaining, tone);
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
