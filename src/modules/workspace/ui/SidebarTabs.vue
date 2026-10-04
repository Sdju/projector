<script setup lang="ts">
import type { Component } from "vue";
import type { WorkspaceCapabilities } from "../../workspace-api/index.ts";
import UiButton from "../../../common/ui/UiButton.vue";
import IconBot from "~icons/lucide/bot";
import IconRefresh from "~icons/lucide/rotate-cw";
import IconSettings from "~icons/lucide/settings-2";

export interface SidebarItem {
  id: string;
  title: string;
  icon: Component;
  badge: number;
  command?: string;
}
defineProps<{
  section: string;
  items: SidebarItem[];
  capabilities: Readonly<WorkspaceCapabilities>;
}>();
const emit = defineEmits<{
  "update:section": [section: string];
  command: [id: string];
  refresh: [];
}>();
</script>

<template>
  <nav class="side-tabs" aria-label="Разделы проекта">
    <button
      v-for="item in items"
      :key="item.id"
      :class="{ selected: section === item.id }"
      :aria-pressed="section === item.id"
      :title="item.title"
      :aria-label="item.badge ? `${item.title}: ${item.badge}` : item.title"
      @click="item.command ? emit('command', item.command) : emit('update:section', item.id)"
    >
      <component :is="item.icon" :class="{ 'git-logo': item.id === 'git' }" aria-hidden="true" />
      <span v-if="item.badge" aria-hidden="true">{{ item.badge }}</span>
    </button>
    <div class="side-actions">
      <UiButton
        icon
        size="sm"
        title="Настройки Projector"
        aria-label="Настройки Projector"
        data-command="ide.workbench.settings.open"
        @click="emit('command', 'ide.workbench.settings.open')"
      >
        <IconSettings aria-hidden="true" />
      </UiButton>
      <UiButton
        icon
        size="sm"
        v-if="capabilities.agent"
        title="Чат с агентом"
        aria-label="Чат с агентом"
        data-command="ide.workbench.agent.open"
        @click="emit('command', 'ide.workbench.agent.open')"
      >
        <IconBot aria-hidden="true" />
      </UiButton>
      <UiButton
        icon
        size="sm"
        title="Обновить обзор"
        aria-label="Обновить обзор"
        @click="emit('refresh')"
      >
        <IconRefresh aria-hidden="true" />
      </UiButton>
    </div>
  </nav>
</template>

<style scoped>
.side-tabs {
  display: flex;
  height: 40px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--line);
  align-items: stretch;
  gap: var(--sp-3);
  padding: 0 var(--sp-3);
}
.side-tabs > button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-1);
  min-width: 24px;
  white-space: nowrap;
  font-size: var(--fs-xs);
  color: var(--muted);
  border-bottom: 2px solid transparent;
  transition: color var(--t-fast);
}
.side-tabs > button:hover {
  color: var(--text);
}
.side-tabs > button.selected {
  color: var(--text);
  border-color: var(--focus);
}
.side-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  padding-left: var(--sp-3);
  border-left: 1px solid var(--line);
  flex-shrink: 0;
}
.side-tabs > button svg {
  width: 14px;
  height: 14px;
}
.git-logo :deep(path) {
  fill: currentColor;
}
.side-tabs span {
  color: var(--run);
  font: var(--fs-2xs) var(--mono);
}
@media (max-width: 600px) {
  .side-tabs {
    gap: 8px;
    padding: 0 8px;
  }
  .side-tabs > button {
    font-size: var(--fs-2xs);
  }
}
</style>
