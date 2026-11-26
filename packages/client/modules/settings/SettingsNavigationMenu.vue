<script setup lang="ts">
import type { SettingsSection } from "./sections.ts";
import UiIsland from "../../common/ui/UiIsland.vue";
import UiIslandLabel from "../../common/ui/UiIslandLabel.vue";
import type { useIslandMenu } from "../../common/utilities/island-menu.ts";

defineProps<{
  groups: { group: string; sections: SettingsSection[] }[];
  selected: string;
  menu: ReturnType<typeof useIslandMenu>;
}>();
const emit = defineEmits<{ select: [id: string] }>();
</script>

<template>
  <UiIsland :menu="menu" label="Разделы настроек" :width="360">
    <nav class="island-navigation" aria-label="Разделы настроек">
      <template v-for="{ group, sections } in groups" :key="group">
        <UiIslandLabel>{{ group }}</UiIslandLabel>
        <template v-for="section in sections" :key="section.id">
          <button
            type="button"
            :aria-current="section.id === selected ? 'page' : undefined"
            :class="{ selected: section.id === selected }"
            @click="emit('select', section.id)"
          >
            {{ section.title }}
          </button>
          <div v-if="section.items?.length" class="island-items">
            <button
              v-for="item in section.items"
              :key="item.id"
              type="button"
              :aria-current="item.id === selected ? 'page' : undefined"
              :class="{ selected: item.id === selected, problem: item.problem }"
              @click="emit('select', item.id)"
            >
              <span class="item-title">{{ item.title }}</span
              ><span v-if="item.hint" class="item-hint">{{ item.hint }}</span>
            </button>
          </div>
        </template>
      </template>
      <p v-if="!groups.length" class="no-results" role="status">Нет подходящих разделов</p>
    </nav>
  </UiIsland>
</template>

<style scoped>
.island-navigation button {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: var(--control-h);
  padding: var(--sp-2);
  border-radius: var(--r-sm);
  text-align: left;
  color: var(--text-2);
}
.island-navigation button:hover {
  background: var(--hover);
}
.island-navigation button.selected {
  background: var(--selection);
  color: var(--text);
}
.island-items {
  margin-left: var(--sp-3);
  padding-left: var(--sp-2);
  border-left: 1px solid var(--line);
}
.island-items button.problem .item-title::after {
  content: " •";
  color: var(--err);
}
.item-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-hint {
  margin-left: auto;
  padding-left: var(--sp-2);
  color: var(--faint);
  font-size: var(--fs-2xs);
  white-space: nowrap;
}
.no-results {
  color: var(--muted);
  font-size: var(--fs-xs);
  margin: var(--sp-2);
}
</style>
