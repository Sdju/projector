<script setup lang="ts">
import { useId } from "vue";
import { useIntervalFn, useNow } from "@vueuse/core";
import UsageIndicator from "../../_/UsageIndicator.vue";
import { useUsageWindows } from "../../_/usage-windows.ts";
import { publishAgentUsage } from "../../_/usage-summary.ts";
import { useUsagePolling } from "../../_/use-usage-polling.ts";
import { USAGE_PERIOD_SECONDS } from "../../_/usage-pace.ts";
import IconOpenCode from "~icons/simple-icons/opencode";
import type { OpenCodeUsage } from "../../../../../core/modules/agents-integration/opencode/index.ts";
import { useCommandScope } from "../../../../common/utilities/commands.ts";

const { usage, failed } = useUsagePolling<OpenCodeUsage>("/api/opencode/usage");
const now = useNow({ scheduler: (update) => useIntervalFn(update, 1000) });
type WindowName = keyof NonNullable<OpenCodeUsage["windows"]>;
const weekTicks = Array.from({ length: 6 }, (_, day) => ((day + 1) / 7) * 100);
const monthTicks = [7, 14, 21, 28].map((day) => (day / 30) * 100);
const { selectedWindow, selected, remaining, tone, tooltipRows, tooltip, cycle } =
  useUsageWindows<WindowName>({
    title: "OpenCode Go",
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
    cycleOrder: ["monthly", "rolling", "weekly"],
    initial: "weekly",
    usage: () => usage.value,
    windows: () => usage.value?.windows,
    failed: () => failed.value,
    now: () => now.value.getTime(),
  });
const commands = useCommandScope(`opencodeUsage:${useId()}`, () => ({
  surface: "statusBar",
  window: selectedWindow.value,
}));
commands.scope.registerCommand({
  id: "ide.opencode.usage.window.cycle",
  title: "Переключить отображаемый лимит OpenCode Go",
  description:
    "Меняет окно индикатора Go в статусной строке: месяц → 5 часов → неделя. Не запрашивает лимиты заново.",
  run: cycle,
});
publishAgentUsage("opencode", remaining, tone);
</script>

<template>
  <UsageIndicator
    class="opencode-usage"
    title="OpenCode Go"
    :tooltip="tooltip"
    :remaining="remaining"
    :tone="tone"
    :prefix="selected.shortLabel"
    :meter-label="`Остаток лимита OpenCode Go: ${selected.label}`"
    :rows="tooltipRows"
    interactive
    @cycle="commands.run('ide.opencode.usage.window.cycle')"
  >
    <template #icon><IconOpenCode /></template>
  </UsageIndicator>
</template>
