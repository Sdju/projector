<script setup lang="ts">
import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";
import UiStatusDot from "../../../common/ui/UiStatusDot.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiIsland from "../../../common/ui/UiIsland.vue";
import type { useIslandMenu } from "../../../common/utilities/island-menu.ts";
import type { SidebarItem } from "../lib/sidebar-item.ts";

defineProps<{
  picker: ReturnType<typeof useIslandMenu>;
  section: string;
  ordered: SidebarItem[];
  current?: SidebarItem;
  otherBadges: boolean;
  label?: string;
  refreshing?: boolean;
  refreshCommand?: string;
  projectSettings?: boolean;
}>();
const emit = defineEmits<{ toggle: []; choose: [item: SidebarItem]; command: [id: string] }>();
</script>

<template>
  <nav class="side-tabs picker-bar" :aria-label="label ?? 'Разделы проекта'">
    <span :ref="picker.trigger" class="picker">
      <button
        class="current"
        aria-haspopup="dialog"
        :aria-expanded="picker.open.value"
        :aria-controls="picker.open.value ? picker.id : undefined"
        data-command="ide.workbench.section.picker.toggle"
        @click="emit('toggle')"
      >
        <ProjectorIcon v-if="current" :name="current.icon" aria-hidden="true" />
        <span class="name">{{ current?.title ?? "Разделы" }}</span>
        <span v-if="current?.badge" class="count" aria-hidden="true">{{ current.badge }}</span>
        <UiStatusDot
          v-else-if="otherBadges"
          as="i"
          class="dot"
          radius="circle"
          shrink
          tone="success"
          aria-hidden="true"
        />
        <ProjectorIcon name="chevron-down" class="chevron" aria-hidden="true" />
      </button>
    </span>
    <div class="side-actions">
      <UiButton
        shape="icon"
        size="sm"
        title="Обновить раздел"
        :aria-label="refreshing ? 'Обновление раздела' : 'Обновить раздел'"
        :data-command="refreshCommand ?? 'ide.workbench.sidebar.refresh'"
        :busy="refreshing"
        @click="emit('command', refreshCommand ?? 'ide.workbench.sidebar.refresh')"
      >
        <ProjectorIcon name="rotate-cw" aria-hidden="true" />
      </UiButton>
    </div>
  </nav>
  <UiIsland :menu="picker" :label="label ?? 'Разделы проекта'" :width="260">
    <button
      v-for="item in ordered"
      :key="item.id"
      class="sidebar-section-item"
      :class="{ selected: section === item.id, subgroup: !!item.group }"
      :aria-current="section === item.id ? 'true' : undefined"
      @click="emit('choose', item)"
    >
      <ProjectorIcon
        :name="item.icon"
        :class="{ 'git-logo': item.id === 'git' }"
        aria-hidden="true"
      />
      <span class="label">{{ item.title }}</span>
      <span v-if="item.badge" class="count" aria-hidden="true">{{ item.badge }}</span>
      <ProjectorIcon name="check" v-if="section === item.id" class="check" aria-hidden="true" />
    </button>
    <button
      v-if="projectSettings"
      class="sidebar-section-item"
      data-command="ide.workbench.project.settings.open"
      @click="emit('command', 'ide.workbench.project.settings.open')"
    >
      <ProjectorIcon name="sliders-horizontal" aria-hidden="true" />
      <span class="label">Настройки проекта</span>
    </button>
  </UiIsland>
</template>

<style scoped>
.side-tabs {
  display: flex;
  flex-shrink: 0;
  border-bottom: 1px solid var(--line);
}
.side-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  flex-shrink: 0;
}
.git-logo :deep(path) {
  fill: currentColor;
}
/* Мобильная полоса: название раздела с выбором и одна кнопка обновления */
.picker-bar {
  height: 48px;
  align-items: center;
  gap: var(--sp-2);
  padding: 0 var(--sp-2);
}
.picker {
  display: flex;
  min-width: 0;
}
.current {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 40px;
  padding: 0 var(--sp-3);
  border-radius: var(--r-md);
  color: var(--text);
  font: 600 var(--fs-md) var(--sans);
}
.picker-bar .current .name {
  color: var(--text);
  font: inherit;
}
.picker-bar .current .count {
  font: var(--fs-2xs) var(--mono);
}
.current:active,
.current[aria-expanded="true"] {
  background: var(--active);
}
.current svg {
  width: 17px;
  height: 17px;
  color: var(--muted);
}
.current .chevron {
  width: 14px;
  height: 14px;
}
.current .count {
  min-width: 18px;
  padding: 0 5px;
  border-radius: var(--r-full);
  background: var(--bg-3);
  color: var(--run);
  font: var(--fs-2xs) var(--mono);
  line-height: 18px;
  text-align: center;
}
.picker-bar .side-actions {
  border-left: 0;
  padding-left: 0;
}
</style>

<style scoped src="./sidebar-section-item.css"></style>
