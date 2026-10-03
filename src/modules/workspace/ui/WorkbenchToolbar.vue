<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import IconSidebar from "~icons/lucide/panel-left";
import IconLayout from "~icons/lucide/layout-template";
import IconEye from "~icons/lucide/eye";
import IconTerminal from "~icons/lucide/terminal";
import IconCodex from "~icons/simple-icons/openai";
import IconClaude from "~icons/simple-icons/claude";
import IconOpenCode from "~icons/simple-icons/opencode";

defineProps<{
  sidebarHidden: boolean;
  terminalsBusy: boolean;
  terminalsError?: string;
  /** Скрытые блоки дока: кнопка возвращает блок на место. */
  hiddenGroups: { id: string; label: string }[];
}>();
const emit = defineEmits<{
  command: [id: string, args?: unknown];
  "show-group": [id: string];
}>();
const terminalPrograms = [
  { program: "shell", title: "Новый shell", icon: IconTerminal },
  { program: "codex", title: "Новый Codex", icon: IconCodex },
  { program: "claude", title: "Новый Claude Code", icon: IconClaude },
  { program: "opencode", title: "Новый OpenCode", icon: IconOpenCode },
];
</script>

<template>
  <div class="toolbar" role="toolbar" aria-label="Блоки и терминалы">
    <UiButton
      icon
      size="sm"
      :active="!sidebarHidden"
      :aria-pressed="!sidebarHidden"
      title="Боковая панель"
      aria-label="Боковая панель"
      data-command="ide.workbench.sidebar.toggle"
      @click="emit('command', 'ide.workbench.sidebar.toggle')"
    >
      <IconSidebar aria-hidden="true" />
    </UiButton>
    <div class="toolbar-group" role="group" aria-label="Новая терминальная сессия">
      <UiButton
        v-for="entry in terminalPrograms"
        :key="entry.program"
        icon
        size="sm"
        :disabled="terminalsBusy"
        :title="entry.title"
        :aria-label="entry.title"
        @click="emit('command', 'ide.workbench.terminal.new', { program: entry.program })"
      >
        <component :is="entry.icon" aria-hidden="true" />
      </UiButton>
    </div>
    <slot name="terminal-actions" />
    <slot name="terminal-status" />
    <p v-if="terminalsError" class="toolbar-error" role="alert">
      {{ terminalsError }}
    </p>
    <div class="toolbar-spacer" />
    <UiButton
      v-for="group in hiddenGroups"
      :key="group.id"
      variant="chip"
      size="sm"
      :title="`Показать блок: ${group.label}`"
      :aria-label="`Показать блок: ${group.label}`"
      @click="emit('show-group', group.id)"
    >
      <IconEye aria-hidden="true" />{{ group.label }}
    </UiButton>
    <UiButton
      icon
      size="sm"
      title="Сбросить раскладку блоков"
      aria-label="Сбросить раскладку блоков"
      data-command="ide.workbench.layout.reset"
      @click="emit('command', 'ide.workbench.layout.reset')"
    >
      <IconLayout aria-hidden="true" />
    </UiButton>
  </div>
</template>

<style scoped>
.toolbar {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sp-2);
  min-height: 40px;
  padding: 0 var(--sp-3);
  border-bottom: 1px solid var(--line);
  background: var(--bg-sunken);
}
.toolbar-group {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-left: var(--sp-2);
  border-left: 1px solid var(--line);
}
.toolbar-spacer {
  flex: 1;
}
.toolbar-error {
  margin: 0;
  color: var(--err);
  font-size: var(--fs-xs);
}
.toolbar :deep(svg) {
  width: 14px;
  height: 14px;
}
</style>
