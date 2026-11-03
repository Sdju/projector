<script setup lang="ts">
import { computed } from "vue";
import { ProviderBalanceIndicator } from "../provider/index.ts";
import { clientAgents } from "../catalog/index.ts";

// Агенты, отключённые в настройках, не показывают лимиты и не опрашивают сервисы: владелец
// статусной строки передаёт проверку, чтобы композиция интеграций не зависела от модуля чата.
const props = defineProps<{ enabled?: (program: string) => boolean }>();
const agents = computed(() =>
  clientAgents().flatMap((agent) =>
    agent.usage && (props.enabled?.(agent.program) ?? true)
      ? [{ ...agent, usage: agent.usage }]
      : [],
  ),
);
</script>

<template>
  <component v-for="agent in agents" :key="agent.backend" :is="agent.usage" />
  <ProviderBalanceIndicator />
</template>
