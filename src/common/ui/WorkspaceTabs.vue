<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";
import { useCommandScope, commandArgs } from "../utilities/commands.ts";
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
  commandNamespace: string;
  projectId: string;
  commandHandlers: {
    select: (id: string) => unknown;
    close: (id: string) => unknown;
    closeMany: (ids: string[]) => unknown;
    reorder: (ids: string[]) => unknown;
    rename?: (id: string, label: string) => unknown;
  };
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
  projectId: props.projectId,
  busy: !!props.disabled,
}));
const commandId = (action: string) => `${props.commandNamespace}.${action}`;
function findTab(value?: unknown) {
  const args = commandArgs(value);
  if (args.id !== undefined && typeof args.id !== "string")
    throw new Error("id должен быть строкой");
  return props.tabs.find((tab) => tab.id === (args.id ?? (contextId.value || props.activeId)));
}
const register = (
  action: string,
  title: string,
  run: (args?: unknown) => unknown,
  enabled: (args?: unknown) => boolean = () => true,
) =>
  commands.scope.registerCommand({
    id: commandId(action),
    palette: action !== "reorder",
    title,
    run,
    enabled: (args) => !props.disabled && enabled(args),
  });
const hasTab = (args?: unknown) => !!findTab(args);
register(
  "select",
  "Открыть вкладку",
  (args) => props.commandHandlers.select(findTab(args)!.id),
  hasTab,
);
register("close", "Закрыть", (args) => props.commandHandlers.close(findTab(args)!.id), hasTab);
register(
  "closeOthers",
  "Закрыть остальные",
  (args) =>
    props.commandHandlers.closeMany(
      props.tabs.filter((tab) => tab.id !== findTab(args)!.id).map((tab) => tab.id),
    ),
  (args) => hasTab(args) && props.tabs.length > 1,
);
register(
  "closeLeft",
  "Закрыть слева",
  (args) =>
    props.commandHandlers.closeMany(
      props.tabs.slice(0, props.tabs.indexOf(findTab(args)!)).map((tab) => tab.id),
    ),
  (args) => hasTab(args) && props.tabs.indexOf(findTab(args)!) > 0,
);
register(
  "closeRight",
  "Закрыть справа",
  (args) =>
    props.commandHandlers.closeMany(
      props.tabs.slice(props.tabs.indexOf(findTab(args)!) + 1).map((tab) => tab.id),
    ),
  (args) => hasTab(args) && props.tabs.indexOf(findTab(args)!) < props.tabs.length - 1,
);
register(
  "closeAll",
  "Закрыть все",
  () => props.commandHandlers.closeMany(props.tabs.map((tab) => tab.id)),
  () => !!props.tabs.length,
);
register(
  "closeSaved",
  "Закрыть сохранённые",
  () =>
    props.commandHandlers.closeMany(
      props.tabs.filter((tab) => !tab.dirty && !tab.saving).map((tab) => tab.id),
    ),
  () => !!props.closeSaved && props.tabs.some((tab) => !tab.dirty && !tab.saving),
);
register(
  "rename",
  "Переименовать…",
  (value) => {
    const args = commandArgs(value);
    const tab = findTab(value)!;
    if (args.label === undefined) return startRename(tab);
    if (typeof args.label !== "string" || !args.label.trim())
      throw new Error("Укажите label вкладки");
    return props.commandHandlers.rename?.(tab.id, args.label.trim());
  },
  (args) => !!props.renameable && hasTab(args),
);
register("reorder", "Переставить вкладки", (value) => {
  const { ids } = commandArgs(value);
  if (
    !Array.isArray(ids) ||
    ids.length !== props.tabs.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== "string" || !props.tabs.some((tab) => tab.id === id))
  )
    throw new Error("Укажите все id вкладок без повторений");
  return props.commandHandlers.reorder(ids);
});
for (const action of ["next", "previous", "first", "last"])
  register(
    action,
    "Перейти к вкладке",
    (args) => {
      const index = props.tabs.indexOf(findTab(args)!);
      const next =
        action === "first"
          ? 0
          : action === "last"
            ? props.tabs.length - 1
            : (index + (action === "next" ? 1 : props.tabs.length - 1)) % props.tabs.length;
      const tab = props.tabs[next]!;
      const result = props.commandHandlers.select(tab.id);
      strip.value?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      return result;
    },
    hasTab,
  );
register(
  "contextMenu",
  "Открыть меню вкладки",
  (args) => {
    const tab = findTab(args)!;
    contextId.value = tab.id;
    const index = props.tabs.indexOf(tab);
    const target = strip.value?.querySelectorAll<HTMLElement>('[role="tab"]')[index];
    if (target) return menu.value?.openForElement(target);
  },
  hasTab,
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
  if (props.renameable) items.push(item("rename", { separator: true }));
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
    commands.run(commandId("reorder"), { ids });
  }
  endDrag();
}
function navigate(event: KeyboardEvent, id: string) {
  contextId.value = id;
  commands.keydown(event);
}
function activateTab(id: string) {
  contextId.value = id;
  commands.scope.activate();
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
        @focus="activateTab(tab.id)"
        @click="commands.run(commandId('select'), { id: tab.id })"
        @dblclick="renameable && commands.run(commandId('rename'), { id: tab.id })"
        @keydown="navigate($event, tab.id)"
      >
        <slot name="icon" :tab="tab" /><span>{{ tab.label }}</span>
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
