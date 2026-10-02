<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import ContextMenu from "./ContextMenu.vue";
import type { ContextMenuItem } from "./context-menu.ts";
import IconClose from "~icons/lucide/x";

interface Tab {
  id: string;
  label: string;
  title?: string;
  dirty?: boolean;
  saving?: boolean;
  error?: boolean;
}
const props = defineProps<{
  tabs: Tab[];
  activeId: string;
  label: string;
  renameable?: boolean;
  disabled?: boolean;
  actions?: (id: string) => ContextMenuItem[];
  closeSaved?: boolean;
}>();
const emit = defineEmits<{
  select: [id: string];
  close: [id: string];
  closeMany: [ids: string[]];
  reorder: [ids: string[]];
  rename: [id: string, label: string];
}>();
const menu = ref<InstanceType<typeof ContextMenu>>();
const contextId = ref("");
function showContext(event: MouseEvent | KeyboardEvent, tab: Tab) {
  contextId.value = tab.id;
  void menu.value?.open(event);
}
const menuItems = computed<ContextMenuItem[]>(() => {
  const tab = props.tabs.find((tab) => tab.id === contextId.value);
  if (!tab) return [];
  const index = props.tabs.indexOf(tab);
  const closeGroup = (ids: string[]) => emit("closeMany", ids);
  const items: ContextMenuItem[] = [
    { id: "close", label: "Закрыть", run: () => emit("close", tab.id) },
    {
      id: "close-others",
      label: "Закрыть остальные",
      disabled: props.tabs.length < 2,
      run: () => closeGroup(props.tabs.filter((item) => item.id !== tab.id).map((item) => item.id)),
    },
    {
      id: "close-left",
      label: "Закрыть слева",
      disabled: index === 0,
      run: () => closeGroup(props.tabs.slice(0, index).map((item) => item.id)),
    },
    {
      id: "close-right",
      label: "Закрыть справа",
      disabled: index === props.tabs.length - 1,
      run: () => closeGroup(props.tabs.slice(index + 1).map((item) => item.id)),
    },
    {
      id: "close-all",
      label: "Закрыть все",
      run: () => closeGroup(props.tabs.map((item) => item.id)),
    },
  ];
  if (props.closeSaved)
    items.push({
      id: "close-saved",
      label: "Закрыть сохранённые",
      disabled: !props.tabs.some((item) => !item.dirty && !item.saving),
      run: () =>
        closeGroup(props.tabs.filter((item) => !item.dirty && !item.saving).map((item) => item.id)),
    });
  if (props.renameable)
    items.push({
      id: "rename",
      label: "Переименовать…",
      separator: true,
      shortcut: "F2",
      run: () => startRename(tab),
    });
  items.push(...(props.actions?.(tab.id) ?? []));
  return items.map((item) => ({ ...item, disabled: props.disabled || item.disabled }));
});
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) menu.value?.close(false);
  },
);
const strip = ref<HTMLElement>();
const editing = ref("");
const draft = ref("");
const dragging = ref("");
const target = ref("");
const after = ref(false);

async function startRename(tab: Tab) {
  if (!props.renameable || props.disabled) return;
  editing.value = tab.id;
  draft.value = tab.label;
  await nextTick();
  const input = strip.value?.querySelector<HTMLInputElement>("input");
  input?.focus();
  input?.select();
}
function finishRename(save: boolean) {
  const id = editing.value;
  editing.value = "";
  const label = draft.value.trim();
  if (id && save && label && label !== props.tabs.find((tab) => tab.id === id)?.label)
    emit("rename", id, label);
}
function middleClick(event: MouseEvent, id: string) {
  if (event.button !== 1) return;
  event.preventDefault();
  if (!props.disabled) emit("close", id);
}
function dragStart(event: DragEvent, id: string) {
  if (editing.value || props.disabled || !event.dataTransfer) {
    event.preventDefault();
    return;
  }
  dragging.value = id;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-projector-tab", id);
  event.dataTransfer.setData("text/plain", props.tabs.find((tab) => tab.id === id)?.label ?? id);
}
function dragOver(event: DragEvent, id?: string) {
  if (!dragging.value || props.disabled) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  const element = event.currentTarget as HTMLElement;
  const bounds = element.getBoundingClientRect();
  target.value = id ?? props.tabs.at(-1)?.id ?? "";
  after.value = id === undefined || event.clientX > bounds.left + bounds.width / 2;
  const container = strip.value!;
  const viewport = container.getBoundingClientRect();
  if (event.clientX < viewport.left + 32) container.scrollLeft -= 24;
  else if (event.clientX > viewport.right - 32) container.scrollLeft += 24;
}
function endDrag() {
  dragging.value = "";
  target.value = "";
}
function drop(event: DragEvent, id?: string) {
  if (!dragging.value) return;
  event.preventDefault();
  const destination = id ?? props.tabs.at(-1)?.id;
  if (destination && destination !== dragging.value && !props.disabled) {
    const ids = props.tabs.map((tab) => tab.id).filter((key) => key !== dragging.value);
    ids.splice(
      ids.indexOf(destination) + (id === undefined || after.value ? 1 : 0),
      0,
      dragging.value,
    );
    emit("reorder", ids);
  }
  endDrag();
}
function navigate(event: KeyboardEvent, id: string) {
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
    showContext(
      event,
      props.tabs.find((tab) => tab.id === id)!,
    );
    return;
  }
  const index = props.tabs.findIndex((tab) => tab.id === id);
  let next = index;
  if (event.key === "ArrowRight") next = (index + 1) % props.tabs.length;
  else if (event.key === "ArrowLeft") next = (index + props.tabs.length - 1) % props.tabs.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = props.tabs.length - 1;
  else if (event.key === "F2" && props.renameable) {
    event.preventDefault();
    void startRename(props.tabs[index]!);
    return;
  } else return;
  event.preventDefault();
  emit("select", props.tabs[next]!.id);
  strip.value?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
}
watch(
  () => props.activeId,
  async () => {
    await nextTick();
    strip.value
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  },
);
watch(
  () => props.tabs,
  () => {
    if (!props.tabs.some((tab) => tab.id === contextId.value)) menu.value?.close(false);
    if (!props.tabs.some((tab) => tab.id === editing.value)) editing.value = "";
    if (!props.tabs.some((tab) => tab.id === dragging.value)) endDrag();
  },
);
</script>

<template>
  <div
    ref="strip"
    class="workspace-tabs"
    role="tablist"
    :aria-label="label"
    @dragover.self.stop="dragOver($event)"
    @drop.self.stop="drop($event)"
    @dragleave="!strip?.contains($event.relatedTarget as Node) && (target = '')"
  >
    <div
      v-for="tab in tabs"
      :key="tab.id"
      class="workspace-tab"
      :class="{
        selected: tab.id === activeId,
        dirty: tab.dirty,
        saving: tab.saving,
        error: tab.error,
        dragging: tab.id === dragging,
        'drop-before': tab.id === target && !after && tab.id !== dragging,
        'drop-after': tab.id === target && after && tab.id !== dragging,
      }"
      :draggable="!disabled && editing !== tab.id"
      @contextmenu.stop="showContext($event, tab)"
      @dragstart.stop="dragStart($event, tab.id)"
      @dragover.stop="dragOver($event, tab.id)"
      @drop.stop="drop($event, tab.id)"
      @dragend="endDrag"
      @mousedown="$event.button === 1 && $event.preventDefault()"
      @auxclick="middleClick($event, tab.id)"
    >
      <input
        v-if="editing === tab.id"
        v-model="draft"
        class="tab-rename"
        maxlength="80"
        aria-label="Название вкладки"
        @keydown.enter.prevent="finishRename(true)"
        @keydown.esc.prevent.stop="finishRename(false)"
        @blur="finishRename(true)"
        @mousedown.stop
        @click.stop
        @dblclick.stop
      />
      <button
        v-else
        class="tab-label"
        role="tab"
        :aria-selected="tab.id === activeId"
        :tabindex="tab.id === activeId ? 0 : -1"
        :title="tab.title ?? tab.label"
        @click="emit('select', tab.id)"
        @dblclick="startRename(tab)"
        @keydown="navigate($event, tab.id)"
      >
        <slot name="icon" :tab="tab" /><span>{{ tab.label }}</span>
      </button>
      <button
        class="tab-close"
        :disabled="disabled"
        :title="`Закрыть ${tab.label}`"
        :aria-label="`Закрыть ${tab.label}`"
        @click.stop="emit('close', tab.id)"
        @dblclick.stop
      >
        <span
          v-if="tab.dirty || tab.saving"
          class="tab-state"
          :class="{ spinning: tab.saving }"
          role="status"
          :aria-label="
            tab.saving ? 'Сохраняется' : tab.error ? 'Не удалось сохранить' : 'Не сохранено'
          "
        />
        <IconClose
          class="close-icon"
          :class="{ 'has-state': tab.dirty || tab.saving }"
          aria-hidden="true"
        />
      </button>
    </div>
  </div>
  <ContextMenu ref="menu" :items="menuItems" :label="`Действия: ${label}`" />
</template>

<style scoped>
.workspace-tabs {
  display: flex;
  height: 40px;
  flex-shrink: 0;
  overflow-x: auto;
  background: #141412;
  border-bottom: 1px solid var(--line);
  scrollbar-width: thin;
}
.workspace-tab {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  min-width: 90px;
  max-width: 240px;
  border-right: 1px solid var(--line);
  border-top: 2px solid transparent;
  padding: 0 8px 0 12px;
  gap: 10px;
  user-select: none;
}
.workspace-tab:hover {
  background: var(--bg-2);
}
.workspace-tab.selected {
  border-top-color: var(--focus);
  background: var(--bg);
}
.tab-label {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 100%;
  flex: 1;
  text-align: left;
  font-size: 12px;
  color: var(--muted);
}
.tab-label span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.selected .tab-label {
  color: var(--text);
}
.tab-close {
  position: relative;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  padding: 4px;
  border-radius: 3px;
  color: var(--faint);
  opacity: 0;
}
.tab-state {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text);
  position: absolute;
}
.error .tab-state {
  background: var(--err);
}
.tab-state.spinning {
  width: 12px;
  height: 12px;
  background: transparent;
  border: 1.5px solid var(--faint);
  border-top-color: var(--text);
  animation: tab-spin 0.8s linear infinite;
}
.close-icon.has-state {
  visibility: hidden;
}
.tab-close:hover .close-icon.has-state {
  visibility: visible;
}
.tab-close:hover .tab-state:not(.spinning) {
  visibility: hidden;
}
.saving .tab-close:hover .close-icon {
  visibility: hidden;
}
.dirty .tab-close,
.saving .tab-close {
  opacity: 1;
}
@keyframes tab-spin {
  to {
    transform: rotate(360deg);
  }
}
.tab-close svg {
  width: 14px;
  height: 14px;
}
.workspace-tab:hover .tab-close,
.workspace-tab:focus-within .tab-close,
.selected .tab-close {
  opacity: 1;
}
.tab-close:hover:not(:disabled) {
  background: #ffffff12;
  color: var(--text);
}
.tab-label:focus-visible,
.tab-close:focus-visible {
  outline: 1px solid var(--focus);
  outline-offset: -1px;
}
.dragging {
  opacity: 0.45;
}
.drop-before::before,
.drop-after::after {
  content: "";
  position: absolute;
  top: -2px;
  bottom: 0;
  width: 2px;
  background: var(--focus);
  pointer-events: none;
  z-index: 1;
}
.drop-before::before {
  left: 0;
}
.drop-after::after {
  right: 0;
}
.tab-rename {
  width: 150px;
  min-width: 0;
  height: 26px;
  padding: 2px 5px;
  border: 1px solid var(--focus);
  border-radius: 2px;
  font-size: 12px;
  background: var(--bg);
  color: var(--text);
}
@media (hover: none) {
  .tab-close {
    opacity: 1;
  }
}
</style>
