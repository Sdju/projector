<script setup lang="ts">
import type { Component } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
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
  /** Вертикальная полоса-остров слева от панели; без неё — горизонтальные вкладки (мобильный вид). */
  vertical?: boolean;
  /** Панель раздела свёрнута: активный раздел не подсвечивается. */
  collapsed?: boolean;
}>();
const emit = defineEmits<{
  "update:section": [section: string];
  command: [id: string];
}>();
</script>

<template>
  <nav class="side-tabs" :class="{ vertical }" aria-label="Разделы проекта">
    <button
      v-for="item in items"
      :key="item.id"
      :class="{ selected: section === item.id && !collapsed }"
      :aria-pressed="section === item.id && !collapsed"
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
        v-if="!vertical"
        icon
        size="sm"
        title="Обновить раздел"
        aria-label="Обновить раздел"
        data-command="ide.workbench.sidebar.refresh"
        @click="emit('command', 'ide.workbench.sidebar.refresh')"
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
/* Вертикальная полоса лежит прямо на фоне рабочей области, без рамки: островом остаётся только панель */
.side-tabs.vertical {
  flex-direction: column;
  align-items: center;
  width: calc(var(--rail-w, 40px) - var(--island-gap));
  height: auto;
  gap: var(--sp-1);
  padding: 0;
  border: 0;
}
.side-tabs.vertical > button {
  position: relative;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: var(--r-md);
}
.side-tabs.vertical > button:hover {
  background: var(--hover);
}
.side-tabs.vertical > button.selected {
  background: var(--active);
}
.side-tabs.vertical > button svg {
  width: 16px;
  height: 16px;
}
.side-tabs.vertical > button span {
  position: absolute;
  top: 0;
  right: 0;
  min-width: 14px;
  padding: 0 3px;
  border-radius: var(--r-full);
  background: var(--bg-3);
  line-height: 14px;
  text-align: center;
}
.side-tabs.vertical .side-actions {
  flex-direction: column;
  margin: auto 0 0;
  padding: 0;
  border-left: 0;
  gap: var(--sp-1);
}
/* Мобильная полоса разделов — тот же язык, что у вертикальной: иконки с плашкой выбранного раздела */
.side-tabs:not(.vertical) {
  height: 44px;
  align-items: center;
  gap: 2px;
  padding: 0 var(--sp-2);
}
.side-tabs:not(.vertical) > button {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: var(--r-md);
  position: relative;
}
.side-tabs:not(.vertical) > button.selected {
  background: var(--active);
}
.side-tabs:not(.vertical) > button svg {
  width: 17px;
  height: 17px;
}
.side-tabs:not(.vertical) > button span {
  position: absolute;
  top: 0;
  right: 0;
  min-width: 14px;
  padding: 0 3px;
  border-radius: var(--r-full);
  background: var(--bg-3);
  line-height: 14px;
  text-align: center;
}
</style>
