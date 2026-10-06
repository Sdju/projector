<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import { AgentUsageIndicators } from "../../agents-integration/status-bar/index.ts";

/** Кнопки создания терминала и лимиты агентов: лимиты нужны только рядом с терминалами. */
defineProps<{ busy: boolean }>();
defineEmits<{ command: [id: string, args?: unknown] }>();
</script>

<template>
  <UiButton
    v-for="program in ['shell', 'codex', 'claude', 'opencode', 'cursor']"
    :key="program"
    class="chip-new"
    size="sm"
    :disabled="busy"
    :aria-label="`Новый ${program}`"
    @click="$emit('command', 'ide.workbench.terminal.new', { program })"
    >+ {{ program }}</UiButton
  >
  <AgentUsageIndicators />
</template>

<style scoped>
/* Мелкие чипы: полный размер касания даёт ряд, а не каждая кнопка */
.chip-new {
  min-height: 28px;
  height: 28px;
  padding-inline: var(--sp-2);
  border-radius: var(--r-full);
  font-size: var(--fs-xs);
  color: var(--muted);
}
</style>
