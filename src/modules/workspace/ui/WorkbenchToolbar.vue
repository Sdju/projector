<script setup lang="ts">
import type { WorkspaceCapabilities } from "../../workspace-api/index.ts";
import UiButton from "../../../common/ui/UiButton.vue";
import IconSidebar from "~icons/lucide/panel-left";
import IconLayout from "~icons/lucide/layout-template";
import IconEye from "~icons/lucide/eye";

defineProps<{
  capabilities: Readonly<WorkspaceCapabilities>;
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
@media (max-width: 700px), (max-width: 1050px) and (max-height: 500px) and (pointer: coarse) {
  .toolbar {
    flex-wrap: nowrap;
    overflow-x: auto;
    gap: var(--sp-1);
    padding: var(--sp-1) var(--sp-2);
  }
  .toolbar > *,
  .toolbar :deep(.controls) {
    flex-shrink: 0;
  }
  .toolbar :deep(.controls) {
    flex-wrap: nowrap;
  }
  .toolbar-error {
    max-width: 240px;
    white-space: normal;
  }
}
</style>
