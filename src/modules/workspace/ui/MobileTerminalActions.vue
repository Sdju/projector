<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";

/** Кнопки создания терминала в мобильной панели терминалов. */
defineProps<{ busy: boolean }>();
defineEmits<{ command: [id: string, args?: unknown] }>();
</script>

<template>
  <UiButton
    v-for="program in ['shell', 'codex', 'claude', 'opencode']"
    :key="program"
    size="sm"
    :disabled="busy"
    :aria-label="`Новый ${program}`"
    @click="$emit('command', 'ide.workbench.terminal.new', { program })"
    >+ {{ program }}</UiButton
  >
</template>
