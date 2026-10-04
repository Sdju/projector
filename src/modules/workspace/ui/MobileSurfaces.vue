<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";

/** Навигация по поверхностям проекта на узком экране: файлы, редактор, терминалы. */
defineProps<{ terminals: boolean; surface: string; actionsOpen: boolean }>();
defineEmits<{ command: [id: string, args?: unknown] }>();
</script>

<template>
  <nav class="mobile-surfaces" aria-label="Поверхности проекта">
    <UiButton
      v-for="entry in [
        { id: 'files', title: 'Файлы' },
        { id: 'editor', title: 'Редактор' },
        ...(terminals ? [{ id: 'terminal', title: 'Терминалы' }] : []),
      ]"
      :key="entry.id"
      :active="surface === entry.id"
      :aria-pressed="surface === entry.id"
      @click="$emit('command', 'ide.workbench.mobile.surface.show', { surface: entry.id })"
      >{{ entry.title }}</UiButton
    >
    <UiButton
      :active="actionsOpen"
      :aria-expanded="actionsOpen"
      aria-label="Действия проекта"
      @click="$emit('command', 'ide.workbench.mobile.actions.toggle')"
      >···</UiButton
    >
  </nav>
</template>

<style scoped>
.mobile-surfaces {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  height: 40px;
  padding-inline: var(--sp-2);
  border-bottom: 1px solid var(--line);
  background: var(--bg-sunken);
}
.mobile-surfaces .btn {
  min-height: 36px;
  border-color: transparent;
  flex: 1;
}
.mobile-surfaces .btn:last-child {
  flex: none;
  width: 40px;
}
</style>
