<script setup lang="ts">
import type { SettingsSection } from "./sections.ts";
import { ref } from "vue";

defineProps<{ groups: { group: string; sections: SettingsSection[] }[]; selected: string }>();
const emit = defineEmits<{ select: [id: string] }>();
const sidebar = ref<HTMLElement>();
function revealSelection() {
  const button = sidebar.value?.querySelector<HTMLElement>('[aria-current="page"]');
  if (!button || !sidebar.value) return;
  const bounds = button.getBoundingClientRect();
  const container = sidebar.value.getBoundingClientRect();
  if (bounds.right > container.right) sidebar.value.scrollLeft += bounds.right - container.right;
  else if (bounds.left < container.left) sidebar.value.scrollLeft += bounds.left - container.left;
}
defineExpose({ revealSelection });
/* Reordering nested items by dragging them, or with Alt + arrows from the keyboard. */
const itemDrag = ref("");
const itemTarget = ref("");
const itemAfter = ref(false);
function itemDragStart(event: DragEvent, id: string) {
  itemDrag.value = id;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  }
}
function itemDragEnd() {
  itemDrag.value = "";
  itemTarget.value = "";
}
/** The row under the pointer, or the nearest one above it; gaps between rows take drops too. */
function rowAt(list: HTMLElement, clientY: number): { id: string; after: boolean } | undefined {
  let hit: { id: string; after: boolean } | undefined;
  for (const row of list.querySelectorAll<HTMLElement>(":scope > li")) {
    const bounds = row.getBoundingClientRect();
    const id = row.dataset.id ?? "";
    if (clientY < bounds.top) return hit ?? { id, after: false };
    hit = { id, after: clientY > bounds.top + bounds.height / 2 };
  }
  return hit;
}
function listDragOver(event: DragEvent, section: SettingsSection) {
  if (!itemDrag.value || !section.reorder) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  const hit = rowAt(event.currentTarget as HTMLElement, event.clientY);
  itemTarget.value = hit && hit.id !== itemDrag.value ? hit.id : "";
  itemAfter.value = hit?.after ?? false;
}
function listDrop(event: DragEvent, section: SettingsSection) {
  if (!itemDrag.value || !section.reorder || !section.items) return;
  event.preventDefault();
  const hit = rowAt(event.currentTarget as HTMLElement, event.clientY);
  const dragged = itemDrag.value;
  itemDragEnd();
  if (!hit || hit.id === dragged) return;
  const ids = section.items.map((item) => item.id).filter((key) => key !== dragged);
  const at = ids.indexOf(hit.id);
  if (at < 0) return;
  ids.splice(at + (hit.after ? 1 : 0), 0, dragged);
  section.reorder(ids);
}
function itemKey(event: KeyboardEvent, section: SettingsSection, index: number) {
  if (!event.altKey || !section.reorder || !section.items) return;
  const to = event.key === "ArrowUp" ? index - 1 : event.key === "ArrowDown" ? index + 1 : -1;
  const ids = section.items.map((item) => item.id);
  if (to < 0 || to >= ids.length) return;
  event.preventDefault();
  [ids[index], ids[to]] = [ids[to]!, ids[index]!];
  section.reorder(ids);
}
</script>

<template>
  <nav ref="sidebar" class="sidebar" aria-label="Разделы настроек">
    <div v-for="{ group, sections } in groups" :key="group" class="group">
      <h2>{{ group }}</h2>
      <template v-for="section in sections" :key="section.id">
        <button
          type="button"
          :aria-current="section.id === selected ? 'page' : undefined"
          :class="{ selected: section.id === selected }"
          @click="emit('select', section.id)"
        >
          {{ section.title }}
        </button>
        <ul
          v-if="section.items?.length"
          class="items"
          @dragover="listDragOver($event, section)"
          @drop="listDrop($event, section)"
        >
          <li
            v-for="(item, at) in section.items"
            :key="item.id"
            :data-id="item.id"
            :draggable="!!section.reorder"
            :class="{
              dragging: itemDrag === item.id,
              'drop-before': itemTarget === item.id && !itemAfter,
              'drop-after': itemTarget === item.id && itemAfter,
            }"
            @dragstart="itemDragStart($event, item.id)"
            @dragend="itemDragEnd"
          >
            <button
              type="button"
              :aria-current="item.id === selected ? 'page' : undefined"
              :class="{ selected: item.id === selected, problem: item.problem }"
              @click="emit('select', item.id)"
              @keydown="itemKey($event, section, at)"
            >
              <span class="item-title">{{ item.title }}</span>
              <span v-if="item.hint" class="item-hint">{{ item.hint }}</span>
            </button>
          </li>
        </ul>
      </template>
    </div>
    <p v-if="!groups.length" class="no-results" role="status">Нет подходящих разделов</p>
  </nav>
</template>

<style scoped>
.sidebar {
  padding: var(--sp-2);
  background: var(--theme-chrome, var(--bg-2));
  border-right: 1px solid var(--line);
}
.group + .group {
  margin-top: var(--sp-3);
}
.group h2 {
  margin: var(--sp-2);
  color: var(--faint);
  font-size: var(--fs-2xs);
  font-weight: 500;
}
.group button {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: var(--control-h);
  padding: var(--sp-1) var(--sp-2);
  border-radius: var(--r-sm);
  text-align: left;
  font-size: var(--fs-xs);
  color: var(--text-2);
}
.group button:hover {
  background: var(--hover);
}
.group button.selected {
  background: var(--selection);
  color: var(--text);
}
.items {
  display: grid;
  gap: 1px;
  margin: 0 0 var(--sp-1) var(--sp-3);
  padding: 0 0 0 var(--sp-2);
  border-left: 1px solid var(--line);
  list-style: none;
}
.items button {
  min-height: 26px;
  font-size: var(--fs-xs);
}
.items li {
  position: relative;
}
.items li.dragging {
  opacity: 0.45;
}
.items li.drop-before::before,
.items li.drop-after::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--focus);
  pointer-events: none;
}
.items li.drop-before::before {
  top: -1px;
}
.items li.drop-after::after {
  bottom: -1px;
}
.items button.problem .item-title::after {
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
