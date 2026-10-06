<script setup lang="ts">
import type { WorkspaceCapabilities } from "../../workspace-api/index.ts";
import LayoutMenu from "./LayoutMenu.vue";
import type { LayoutPreset } from "../lib/workbench-layout.ts";

defineProps<{
  capabilities: Readonly<WorkspaceCapabilities>;
  /** Узкий экран: раскладка блоков заменена поверхностями, остаются запуск и ссылки. */
  mobile?: boolean;
  sidebarHidden: boolean;
  terminalsBusy: boolean;
  terminalsError?: string;
  /** Блоки дока и выбранная готовая раскладка для острова раскладки. */
  layoutGroups: { id: string; role?: string; label: string; hidden: boolean }[];
  preset?: LayoutPreset;
  presetsAvailable: boolean;
}>();
const emit = defineEmits<{
  command: [id: string, args?: unknown];
}>();
</script>

<template>
  <div class="toolbar" role="toolbar" aria-label="Блоки и терминалы">
    <slot name="terminal-status" />
    <p v-if="terminalsError" class="toolbar-error" role="alert">
      {{ terminalsError }}
    </p>
    <div class="toolbar-spacer" />
    <slot name="terminal-actions" />
    <LayoutMenu
      v-if="!mobile"
      :groups="layoutGroups"
      :preset="preset"
      :presets-available="presetsAvailable"
      :sidebar-hidden="sidebarHidden"
      @command="(id, args) => emit('command', id, args)"
    />
  </div>
</template>

<style scoped>
/* На десктопе полоса телепортируется в шапку и живёт на общем фоне, без собственной подложки */
.toolbar {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
  min-height: var(--control-h);
}
.toolbar-spacer {
  flex: 1;
}
.toolbar-error {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
    flex: none;
    gap: var(--sp-1);
  }
  .toolbar-spacer {
    display: none;
  }
  .toolbar-error {
    display: none;
  }
}
</style>
