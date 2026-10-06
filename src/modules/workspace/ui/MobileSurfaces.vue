<script setup lang="ts">
import { computed } from "vue";
import IconFiles from "~icons/lucide/folder-tree";
import IconEditor from "~icons/lucide/file-code";
import IconTerminal from "~icons/lucide/terminal";

/** Навигация по поверхностям проекта на узком экране: файлы, редактор, терминалы. */
const props = defineProps<{ terminals: boolean; surface: string }>();
defineEmits<{ command: [id: string, args?: unknown] }>();
const entries = computed(() => [
  { id: "files", title: "Файлы", icon: IconFiles },
  { id: "editor", title: "Редактор", icon: IconEditor },
  ...(props.terminals ? [{ id: "terminal", title: "Терминалы", icon: IconTerminal }] : []),
]);
</script>

<template>
  <nav class="mobile-surfaces" aria-label="Поверхности проекта">
    <button
      v-for="entry in entries"
      :key="entry.id"
      class="surface-tab"
      :class="{ active: surface === entry.id }"
      :aria-pressed="surface === entry.id"
      :aria-label="entry.title"
      :data-command="'ide.workbench.mobile.surface.show'"
      @click="$emit('command', 'ide.workbench.mobile.surface.show', { surface: entry.id })"
    >
      <component :is="entry.icon" aria-hidden="true" />
      <span>{{ entry.title }}</span>
    </button>
  </nav>
</template>

<style scoped>
/* Плавающая «пилюля» внизу, в зоне большого пальца: активный пункт раскрывается подписью */
.mobile-surfaces {
  grid-row: 4;
  grid-column: 1;
  justify-self: center;
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: var(--island-gap);
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: var(--r-full);
  background: var(--bg);
  box-shadow: var(--shadow-popover);
}
.surface-tab {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: 34px;
  min-width: 40px;
  padding-inline: 11px;
  justify-content: center;
  border-radius: var(--r-full);
  color: var(--muted);
  font-size: var(--fs-xs);
  transition:
    background var(--t-fast),
    color var(--t-fast);
}
.surface-tab svg {
  width: 17px;
  height: 17px;
  flex: none;
}
.surface-tab span {
  display: none;
}
.surface-tab.active {
  background: var(--active);
  color: var(--text);
  padding-inline: 14px;
}
.surface-tab.active span {
  display: inline;
}
</style>
