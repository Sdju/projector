<script setup lang="ts">
import UiControl from "../../../common/ui/UiControl.vue";
import UiSpinner from "../../../common/ui/UiSpinner.vue";
import { computed, nextTick, ref, useId, watch } from "vue";
import { useCommandScope } from "../../../common/utilities/commands.ts";
import { tabDrag } from "../../../common/utilities/tab-drag.ts";
import ContextMenu from "../../../common/ui/ContextMenu.vue";
import UiIsland from "../../../common/ui/UiIsland.vue";
import { useIslandMenu } from "../../../common/utilities/island-menu.ts";
import type { ContextMenuItem } from "../../../common/ui/context-menu.ts";
import IconClose from "~icons/lucide/x";
import IconChevron from "~icons/lucide/chevron-down";
import IconCheck from "~icons/lucide/check";
import {
  registerTabCommands,
  tabCommandId,
  type DockCommandHandlers,
  type DockTab,
} from "../lib/tab-commands.ts";

type Tab = DockTab;
const props = defineProps<{
  tabs: Tab[];
  activeId: string;
  label: string;
  disabled?: boolean;
  /** Идентификатор полосы: по нему вкладки отличают перестановку от переноса из другой полосы. */
  group?: string;
  /** Полоса не в фокусе: выбранная вкладка подсвечивается слабее. */
  dim?: boolean;
  /** Тесная полоса: видна только выбранная вкладка, остальные — в списке с выбором. */
  compact?: boolean;
  actions?: (id: string) => ContextMenuItem[];
  closeSaved?: boolean;
  commandNamespace: string;
  projectId: string;
  commandHandlers: DockCommandHandlers;
}>();
const menu = ref<InstanceType<typeof ContextMenu>>();
const contextId = ref("");
function showContext(event: MouseEvent | KeyboardEvent, tab: Tab) {
  contextId.value = tab.id;
  commands.scope.activate();
  void menu.value?.open(event);
}
const commands = useCommandScope(`tabs:${useId()}`, () => ({
  surface: "tabs",
  namespace: props.commandNamespace,
  activeTab: props.activeId,
  tabs: JSON.stringify(props.tabs.map(({ id, label }) => ({ id, label }))),
  projectId: props.projectId,
  busy: !!props.disabled,
}));
const commandId = (action: string) => tabCommandId(props.commandNamespace, action);
const strip = ref<HTMLElement>();
const shown = computed(() =>
  props.compact ? props.tabs.filter((tab) => tab.id === props.activeId) : props.tabs,
);
const picker = useIslandMenu({
  anchor: "right",
  initialFocus: [".pick-item.current", ".pick-item"],
  items: ".pick-item",
});
function choose(id: string) {
  picker.close();
  commands.run(commandId("select"), { id });
}
const { findTab } = registerTabCommands({
  props,
  commands,
  contextId,
  strip,
  menu,
  startRename,
});
commands.scope.registerCommand({
  id: commandId("picker"),
  title: "Показать список вкладок блока",
  description:
    "Открывает список всех вкладок блока с выбором. Доступен, когда блок узкий и полоса показывает только выбранную вкладку.",
  enabled: () => !props.disabled && !!props.compact && props.tabs.length > 1,
  run: () => void picker.toggle(),
});
watch(
  () => props.compact,
  (compact) => !compact && picker.close(false),
);
const menuItems = computed<ContextMenuItem[]>(() => {
  const tab = findTab();
  if (!tab) return [];
  const item = (action: string, options: { separator?: boolean } = {}) =>
    commands.item(commandId(action), { id: tab.id }, options);
  const items: ContextMenuItem[] = [
    "close",
    "closeOthers",
    "closeLeft",
    "closeRight",
    "closeAll",
  ].map((action) => item(action));
  if (props.closeSaved) items.push(item("closeSaved"));
  if (tab.renameable) items.push(item("rename", { separator: true }));
  items.push(...(props.actions?.(tab.id) ?? []));
  return items.map((item) => ({ ...item, disabled: props.disabled || item.disabled }));
});
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) menu.value?.close(false);
  },
);
const editing = ref("");
const draft = ref("");
const dragging = ref("");
const groupId = computed(() => props.group ?? "");
const target = ref("");
const after = ref(false);

async function startRename(tab: Tab) {
  if (!tab.renameable || props.disabled) return;
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
    commands.run(commandId("rename"), { id, label });
}
function middleClick(event: MouseEvent, id: string) {
  if (event.button !== 1) return;
  event.preventDefault();
  if (!props.disabled) commands.run(commandId("close"), { id });
}
function dragStart(event: DragEvent, id: string) {
  if (editing.value || props.disabled || !event.dataTransfer) {
    event.preventDefault();
    return;
  }
  dragging.value = id;
  tabDrag.value = { id, group: groupId.value };
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-projector-tab", id);
  event.dataTransfer.setData("text/plain", props.tabs.find((tab) => tab.id === id)?.label ?? id);
}
function accepts() {
  const drag = tabDrag.value;
  if (!drag || props.disabled) return false;
  return drag.group === groupId.value || !!props.commandHandlers.move;
}
function dragOver(event: DragEvent, id?: string) {
  if (!accepts()) return;
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
  if (dragging.value && tabDrag.value?.id === dragging.value) tabDrag.value = undefined;
  dragging.value = "";
  target.value = "";
}
function drop(event: DragEvent, id?: string) {
  const drag = tabDrag.value;
  if (!drag || !accepts()) return;
  event.preventDefault();
  const destination = id ?? props.tabs.at(-1)?.id;
  const place = id === undefined || after.value ? 1 : 0;
  if (drag.group === groupId.value) {
    if (destination && destination !== drag.id) {
      const ids = props.tabs.map((tab) => tab.id).filter((key) => key !== drag.id);
      ids.splice(ids.indexOf(destination) + place, 0, drag.id);
      commands.run(commandId("reorder"), { ids });
    }
  } else {
    const index = destination ? props.tabs.findIndex((tab) => tab.id === destination) + place : 0;
    void props.commandHandlers.move!(drag.id, index);
  }
  target.value = "";
  dragging.value = "";
  // The source element may be gone after a move, so its dragend never arrives.
  tabDrag.value = undefined;
}
function navigate(event: KeyboardEvent, id: string) {
  contextId.value = id;
  commands.keydown(event);
}
function activateTab(id: string) {
  contextId.value = id;
  commands.scope.activate();
}
function dblclickTab(tab: Tab) {
  if (tab.preview) commands.run(commandId("pin"), { id: tab.id });
  else if (tab.renameable) commands.run(commandId("rename"), { id: tab.id });
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
    if (dragging.value && !props.tabs.some((tab) => tab.id === dragging.value)) endDrag();
  },
);
</script>

<template>
  <div
    ref="strip"
    class="workspace-tabs"
    :class="{ dim, compact }"
    role="tablist"
    :aria-label="label"
    @dragover.self.stop="dragOver($event)"
    @drop.self.stop="drop($event)"
    @dragleave="!strip?.contains($event.relatedTarget as Node) && (target = '')"
  >
    <div
      v-for="tab in shown"
      :key="tab.id"
      class="workspace-tab"
      :class="{
        selected: tab.id === activeId,
        dirty: tab.dirty,
        saving: tab.saving,
        error: tab.error,
        preview: tab.preview,
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
      <UiControl
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
        @focus="activateTab(tab.id)"
        @click="commands.run(commandId('select'), { id: tab.id })"
        @dblclick="dblclickTab(tab)"
        @keydown="navigate($event, tab.id)"
      >
        <slot name="icon" :tab="tab" /><span class="u-truncate">{{ tab.label }}</span>
      </button>
      <button
        class="tab-close"
        :disabled="disabled"
        :title="`Закрыть ${tab.label}`"
        :aria-label="`Закрыть ${tab.label}`"
        @click.stop="commands.run(commandId('close'), { id: tab.id })"
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
        >
          <UiSpinner v-if="tab.saving" />
        </span>
        <IconClose
          class="close-icon"
          :class="{ 'has-state': tab.dirty || tab.saving }"
          aria-hidden="true"
        />
      </button>
    </div>
  </div>
  <span v-if="compact && tabs.length > 1" :ref="picker.trigger" class="tab-picker">
    <button
      type="button"
      class="picker-button"
      :class="{ open: picker.open.value }"
      :disabled="disabled"
      :title="`Все вкладки блока: ${tabs.length}`"
      :aria-label="`Все вкладки блока: ${tabs.length}`"
      aria-haspopup="dialog"
      :aria-expanded="picker.open.value"
      :aria-controls="picker.open.value ? picker.id : undefined"
      :data-command="commandId('picker')"
      @click="commands.run(commandId('picker'))"
    >
      <span class="picker-count">{{ tabs.length }}</span>
      <IconChevron aria-hidden="true" />
    </button>
  </span>
  <UiIsland v-if="compact" :menu="picker" :label="`Вкладки: ${label}`" :width="280">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      class="pick-item"
      :class="{ current: tab.id === activeId }"
      :aria-current="tab.id === activeId ? 'true' : undefined"
      :title="tab.title ?? tab.label"
      @click="choose(tab.id)"
    >
      <slot name="icon" :tab="tab" />
      <span class="pick-label u-truncate">{{ tab.label }}</span>
      <span
        v-if="tab.dirty || tab.saving"
        class="pick-state"
        :class="{ error: tab.error }"
        role="status"
        :aria-label="
          tab.saving ? 'Сохраняется' : tab.error ? 'Не удалось сохранить' : 'Не сохранено'
        "
      />
      <IconCheck v-if="tab.id === activeId" class="pick-check" aria-hidden="true" />
    </button>
  </UiIsland>
  <ContextMenu ref="menu" :items="menuItems" :label="`Действия: ${label}`" />
</template>

<style scoped>
.workspace-tabs {
  display: flex;
  height: 40px;
  flex-shrink: 0;
  overflow-x: auto;
  background: var(--theme-panel-background, var(--bg-sunken));
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
[data-theme-effects] .workspace-tab:hover {
  background: var(--hover);
}
/* Тесная полоса: одна выбранная вкладка занимает всё место, остальные — в списке справа */
.workspace-tabs.compact {
  overflow: hidden;
}
.compact .workspace-tab {
  flex: 1;
  min-width: 0;
  max-width: none;
}
.tab-picker {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  height: 40px;
  padding: 0 var(--sp-1);
  border-bottom: 1px solid var(--line);
  border-left: 1px solid var(--line);
  background: var(--theme-panel-background, var(--bg-sunken));
}
.picker-button {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 28px;
  padding: 0 var(--sp-1);
  border-radius: var(--r-sm);
  color: var(--muted);
  font: var(--fs-2xs) var(--mono);
}
.picker-button:hover:not(:disabled),
.picker-button.open {
  background: var(--active);
  color: var(--text);
}
.picker-button svg {
  width: 14px;
  height: 14px;
}
.pick-item {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: var(--control-h);
  padding: 0 var(--sp-3);
  border-radius: var(--r-md);
  color: var(--text);
  text-align: left;
}
.pick-item:hover,
.pick-item:focus-visible {
  background: var(--hover);
  outline: none;
}
.pick-item.current {
  background: var(--active);
}
.pick-label {
  flex: 1;
  min-width: 0;
}
.pick-state {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--text);
}
.pick-state.error {
  background: var(--err);
}
.pick-check {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--focus);
}
.workspace-tab.selected {
  border-top-color: var(--focus);
  background: var(--bg);
}
[data-theme-effects] .workspace-tab.selected {
  background: var(--active);
}
.dim .workspace-tab.selected {
  border-top-color: var(--line-strong);
}
.tab-label {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 100%;
  flex: 1;
  text-align: left;
  font-size: var(--fs-xs);
  color: var(--muted);
}

.selected .tab-label {
  color: var(--text);
}
.workspace-tab.preview .tab-label {
  font-style: italic;
}
.tab-close {
  position: relative;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  padding: 4px;
  border-radius: var(--r-sm);
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
  display: grid;
  width: 12px;
  height: 12px;
  background: transparent;
  place-items: center;
}
.tab-close .tab-state svg {
  width: 12px;
  height: 12px;
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
  background: var(--active);
  color: var(--text);
}
.tab-label:focus-visible,
.tab-close:focus-visible {
  outline-offset: -2px;
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
  border-radius: var(--r-sm);
  font-size: var(--fs-xs);
  background: var(--bg);
  color: var(--text);
}
@media (hover: none) {
  .tab-close {
    opacity: 1;
  }
}
@media (max-width: 700px) {
  .tab-close {
    min-width: 36px;
    min-height: 40px;
    opacity: 1;
  }
  .workspace-tab {
    gap: var(--sp-1);
    padding-right: var(--sp-1);
  }
}
</style>
