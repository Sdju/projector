<script setup lang="ts">
import type { AgentPermissionMode } from "../model/types.ts";

const mode = defineModel<AgentPermissionMode>({ required: true });
defineProps<{ disabled: boolean }>();
const options: { value: AgentPermissionMode; label: string; hint: string }[] = [
  { value: "default", label: "Спрашивать", hint: "Запрос перед правками и командами" },
  {
    value: "acceptEdits",
    label: "Правки без вопросов",
    hint: "Файлы меняются сразу, команды — по запросу",
  },
  { value: "bypassPermissions", label: "Всё без вопросов", hint: "Без запросов разрешений" },
];
</script>

<template>
  <select
    v-model="mode"
    class="permission-mode"
    :disabled="disabled"
    aria-label="Режим разрешений"
    :title="options.find((item) => item.value === mode)?.hint"
  >
    <option v-for="item in options" :key="item.value" :value="item.value">{{ item.label }}</option>
  </select>
</template>

<style scoped>
.permission-mode {
  min-width: 0;
  max-width: 45%;
  padding: 2px 4px;
  border: 0;
  background: none;
  color: var(--muted);
  font: var(--fs-2xs) var(--mono);
  cursor: pointer;
}
.permission-mode:hover:not(:disabled),
.permission-mode:focus-visible {
  color: var(--text);
}
</style>
