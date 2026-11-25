<script setup lang="ts">
import { computed } from "vue";
import { usageBarItems } from "./usage-items.ts";

// Агенты, отключённые в настройках, не показывают лимиты и не опрашивают сервисы: владелец
// статусной строки передаёт проверку, чтобы композиция интеграций не зависела от модуля чата.
const props = defineProps<{ enabled?: (program: string) => boolean }>();
const items = computed(() => usageBarItems(props.enabled));
</script>

<template>
  <component v-for="item in items" :key="item.id" :is="item.component" v-bind="item.props" />
</template>
