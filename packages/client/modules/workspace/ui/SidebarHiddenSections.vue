<script setup lang="ts">
import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiIsland from "../../../common/ui/UiIsland.vue";
import type { useIslandMenu } from "../../../common/utilities/island-menu.ts";
import type { SidebarItem } from "../lib/sidebar-item.ts";

defineProps<{
  overflow: ReturnType<typeof useIslandMenu>;
  hiddenItems: SidebarItem[];
  error: string;
}>();
const emit = defineEmits<{ choose: [item: SidebarItem]; restore: [id: string] }>();
</script>

<template>
  <UiIsland :menu="overflow" label="Скрытые разделы" :width="280">
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="!hiddenItems.length" class="empty">Скрытых разделов нет</p>
    <div v-for="item in hiddenItems" :key="item.id" class="hidden-row">
      <button class="sidebar-section-item" @click="emit('choose', item)">
        <ProjectorIcon :name="item.icon" aria-hidden="true" /><span class="label">{{
          item.title
        }}</span>
        <span v-if="item.badge" class="count">{{ item.badge }}</span>
      </button>
      <UiButton
        shape="icon"
        size="sm"
        :title="`Вернуть «${item.title}»`"
        :aria-label="`Вернуть «${item.title}»`"
        data-command="ide.workbench.section.visibility.set"
        @click="emit('restore', item.id)"
        ><ProjectorIcon name="eye" aria-hidden="true"
      /></UiButton>
    </div>
  </UiIsland>
</template>

<style scoped>
.hidden-row {
  display: flex;
  align-items: center;
  border-radius: var(--r-md);
}
.hidden-row:hover {
  background: var(--hover);
}
.hidden-row .sidebar-section-item {
  flex: 1;
  min-width: 0;
}
.hidden-row .sidebar-section-item:hover {
  background: transparent;
}
.empty {
  margin: var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-xs);
}
</style>

<style scoped src="./sidebar-section-item.css"></style>
