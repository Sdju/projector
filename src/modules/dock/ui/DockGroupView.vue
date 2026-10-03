<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import { useEventListener } from "@vueuse/core";
import WorkspaceTabs from "../../../common/ui/WorkspaceTabs.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import { tabDrag } from "../../../common/utilities/tab-drag.ts";
import IconSplit from "~icons/lucide/columns-2";
import IconMaximize from "~icons/lucide/maximize-2";
import IconMinimize from "~icons/lucide/minimize-2";
import IconHide from "~icons/lucide/eye-off";
import {
  focusGroup,
  movePanel,
  reorderPanels,
  setGroupHidden,
  toggleMaximized,
  type DockGroup,
  type DockTarget,
  type DockZone,
} from "../model/layout.ts";
import { dockKey } from "./context.ts";

const props = defineProps<{ group: DockGroup }>();
const dock = inject(dockKey)!;
const body = ref<HTMLElement>();
const zone = ref<DockZone | "">("");
const focused = computed(() => dock.layout().focused === props.group.id);
const maximized = computed(() => dock.layout().maximized === props.group.id);
const tabs = computed(() => props.group.panels.map((id) => dock.describe(id)));
const canSplit = computed(() => props.group.panels.length > 1);

function zoneAt(event: DragEvent): DockZone {
  const bounds = body.value!.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width;
  const y = (event.clientY - bounds.top) / bounds.height;
  const edges = [
    ["left", x],
    ["right", 1 - x],
    ["top", y],
    ["bottom", 1 - y],
  ] as const;
  const nearest = edges.reduce((best, edge) => (edge[1] < best[1] ? edge : best));
  return nearest[1] < 0.25 ? nearest[0] : "center";
}
/** Перенос вкладки в её же группу или разделение группы единственной вкладкой ничего не меняет. */
function allowed(target: DockZone) {
  const drag = tabDrag.value;
  if (!drag) return true;
  if (drag.group !== props.group.id) return true;
  return target !== "center" && props.group.panels.length > 1;
}

function tabOver(event: DragEvent) {
  if (!tabDrag.value) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  const target = zoneAt(event);
  zone.value = allowed(target) ? target : "";
}
function tabDrop(event: DragEvent) {
  const drag = tabDrag.value;
  if (!drag) return;
  event.preventDefault();
  event.stopPropagation();
  const target = zoneAt(event);
  zone.value = "";
  tabDrag.value = undefined;
  if (allowed(target))
    dock.update(movePanel(dock.layout(), drag.id, { groupId: props.group.id, zone: target }));
}
function externalOver(event: DragEvent) {
  if (tabDrag.value || !dock.acceptsDrop?.(event.dataTransfer)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  zone.value = zoneAt(event);
}
function externalDrop(event: DragEvent) {
  if (tabDrag.value || !dock.acceptsDrop?.(event.dataTransfer)) return;
  event.preventDefault();
  const target: DockTarget = { groupId: props.group.id, zone: zoneAt(event) };
  zone.value = "";
  dock.drop(event, target);
}
// dragleave не приходит при броске на полосу вкладок и при отмене drag: подсветка не должна залипать.
const clearZone = () => (zone.value = "");
watch(() => tabDrag.value, (drag) => !drag && clearZone());
useEventListener(window, "dragend", clearZone);
useEventListener(window, "drop", clearZone, true);
function leave(event: DragEvent) {
  if (!body.value?.contains(event.relatedTarget as Node)) zone.value = "";
}

const handlers = {
  select: (id: string) => dock.select(id),
  close: (id: string) => dock.close(id),
  closeMany: (ids: string[]) => dock.closeMany(ids),
  reorder: (ids: string[]) =>
    dock.update(reorderPanels(dock.layout(), props.group.id, ids)),
  rename: (id: string, label: string) => dock.rename(id, label),
  move: (id: string, index: number) =>
    dock.update(movePanel(dock.layout(), id, { groupId: props.group.id, zone: "center", index })),
};
const focus = () => {
  if (!focused.value) dock.update(focusGroup(dock.layout(), props.group.id));
};
</script>

<template>
  <section
    class="dock-group"
    :class="{ focused, maximized }"
    :data-group="group.id"
    @pointerdown.capture="focus"
    @focusin="focus"
  >
    <header class="dock-header" @dragenter.capture="clearZone" @dragover.capture="clearZone">
      <WorkspaceTabs
        v-if="group.panels.length"
        :tabs="tabs"
        :active-id="group.active"
        :label="`Вкладки блока`"
        :group="group.id"
        :dim="!focused"
        :command-namespace="dock.commandNamespace"
        :project-id="dock.projectId"
        :command-handlers="handlers"
        :actions="dock.tabActions"
        close-saved
      >
        <template #icon="{ tab }">
          <component :is="dock.slots.icon" v-if="dock.slots.icon" v-bind="{ tab }" />
        </template>
      </WorkspaceTabs>
      <div v-else class="dock-fill" />
      <div class="dock-actions">
        <component
          :is="dock.slots.actions"
          v-if="dock.slots.actions"
          v-bind="{ group, activeId: group.active }"
        />
        <UiButton
          icon
          size="sm"
          :disabled="!canSplit"
          title="Разделить вправо"
          aria-label="Разделить вправо"
          @click="
            dock.update(
              movePanel(dock.layout(), group.active, { groupId: group.id, zone: 'right' }),
            )
          "
        >
          <IconSplit aria-hidden="true" />
        </UiButton>
        <UiButton
          icon
          size="sm"
          :active="maximized"
          :title="maximized ? 'Вернуть размер блока' : 'Развернуть блок'"
          :aria-label="maximized ? 'Вернуть размер блока' : 'Развернуть блок'"
          :aria-pressed="maximized"
          @click="dock.update(toggleMaximized(dock.layout(), group.id))"
        >
          <IconMinimize v-if="maximized" aria-hidden="true" /><IconMaximize
            v-else
            aria-hidden="true"
          />
        </UiButton>
        <UiButton
          icon
          size="sm"
          title="Скрыть блок"
          aria-label="Скрыть блок"
          @click="dock.update(setGroupHidden(dock.layout(), group.id, true))"
        >
          <IconHide aria-hidden="true" />
        </UiButton>
      </div>
    </header>
    <div
      ref="body"
      class="dock-body"
      @dragenter.capture="tabOver"
      @dragover.capture="tabOver"
      @drop.capture="tabDrop"
      @dragenter="externalOver"
      @dragover="externalOver"
      @drop="externalDrop"
      @dragleave="leave"
    >
      <template v-for="panel in group.panels" :key="panel">
        <div v-if="panel === group.active" class="dock-panel" :data-panel="panel">
          <component
            :is="dock.slots.panel"
            v-if="dock.slots.panel"
            v-bind="{ id: panel, group: group.id, focused }"
          />
        </div>
      </template>
      <div v-if="!group.panels.length" class="dock-empty">
        <component :is="dock.slots.empty" v-if="dock.slots.empty" v-bind="{ group }" />
      </div>
      <div v-if="zone" class="dock-drop" :class="zone" aria-hidden="true" />
    </div>
  </section>
</template>

<style scoped>
.dock-group {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  background: var(--bg);
}
.dock-group.maximized {
  position: absolute;
  inset: 0;
  z-index: var(--z-sticky);
}
.dock-header {
  display: flex;
  flex-shrink: 0;
  min-width: 0;
  background: var(--bg-sunken);
}
.dock-header :deep(.workspace-tabs) {
  flex: 1;
  min-width: 0;
}
.dock-fill {
  flex: 1;
  border-bottom: 1px solid var(--line);
}
.dock-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 2px;
  height: 40px;
  padding: 0 var(--sp-2);
  border-bottom: 1px solid var(--line);
}
.dock-body {
  position: relative;
  flex: 1;
  min-height: 0;
}
.dock-panel {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.dock-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
}
/* Подсветка половины блока показывает, куда встанет вкладка. */
.dock-drop {
  position: absolute;
  z-index: var(--z-sticky);
  pointer-events: none;
  border: 1px dashed var(--focus);
  background: color-mix(in srgb, var(--focus) 18%, transparent);
  transition: all var(--t-fast);
}
.dock-drop.center {
  inset: 0;
}
.dock-drop.left {
  inset: 0 50% 0 0;
}
.dock-drop.right {
  inset: 0 0 0 50%;
}
.dock-drop.top {
  inset: 0 0 50% 0;
}
.dock-drop.bottom {
  inset: 50% 0 0 0;
}
</style>
