<script setup lang="ts">
import { computed } from "vue";
import { ProviderBalanceIndicator } from "../provider/index.ts";
import { clientAgents } from "../catalog/index.ts";
import { PluginUsageIndicator } from "../usage/index.ts";

// Агенты, отключённые в настройках, не показывают лимиты и не опрашивают сервисы: владелец
// статусной строки передаёт проверку, чтобы композиция интеграций не зависела от модуля чата.
const props = defineProps<{ enabled?: (program: string) => boolean }>();
const agents = computed(() =>
  clientAgents().flatMap((agent) => {
    const usage = agent.usage ?? (agent.usageUrl ? PluginUsageIndicator : undefined);
    return usage && (props.enabled?.(agent.program) ?? true) ? [{ ...agent, usage }] : [];
  }),
);
</script>

<template>
  <component
    v-for="agent in agents"
    :key="agent.backend"
    :is="agent.usage"
    v-bind="agent.usageProps"
  />
  <ProviderBalanceIndicator />
</template>
