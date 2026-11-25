<script setup lang="ts">
import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiIsland from "../../../common/ui/UiIsland.vue";
import UiIslandFooter from "../../../common/ui/UiIslandFooter.vue";
import UiIslandHeader from "../../../common/ui/UiIslandHeader.vue";
import UiIslandLabel from "../../../common/ui/UiIslandLabel.vue";
import { useIslandMenu } from "../../../common/utilities/island-menu.ts";
import { useCommandScope } from "../../../common/utilities/commands.ts";
import { computed, useId } from "vue";
import { useDockCatalog, type DockItem } from "../lib/dock-items.ts";
import {
  DOCK_ALIGNS,
  DOCK_EDGES,
  dockAlignTitles,
  dockDragging,
  dockEdgeTitles,
  endDockDrag,
  parseDockAlign,
  parseDockEdge,
} from "../lib/dock-layout.ts";
import DockItems from "./DockItems.vue";

/**
 * Нижняя панель рабочей области. Сами элементы рисует общая лента `DockItems`, а этот
 * компонент добавляет приём сбросов на фон, настройку панелей и кнопку параметров.
 */
const props = defineProps<{ inbox?: boolean }>();
const emit = defineEmits<{ command: [id: string, args?: unknown] }>();
const catalog = useDockCatalog();
const usage = computed(() => catalog.available(props.inbox ?? true).filter((item) => !item.action));
const actions = computed(() =>
  catalog.available(props.inbox ?? true).filter((item) => item.action),
);
const menu = useIslandMenu({
  anchor: "right",
  placement: "above",
  initialFocus: ".config-row",
});
const commands = useCommandScope(`dockBar:${useId()}`, () => ({ surface: "statusBar" }));
commands.scope.registerCommand({
  id: "ide.workbench.dock.settings.toggle",
  title: "Настроить элементы панелей",
  description: "Открывает список индикаторов и кнопок: видимость, панель и порядок.",
  run: () => void menu.toggle(),
});

const dragging = dockDragging;
function dragOver(event: DragEvent) {
  if (!dragging.value) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}
function dropOnBar(event: DragEvent) {
  const item = dragging.value;
  if (!item) return;
  event.preventDefault();
  emit("command", "ide.workbench.dock.item.place", { item, edge: "bottom" });
  endDockDrag();
}

function setVisible(item: DockItem, visible: boolean) {
  emit("command", "ide.workbench.dock.item.visibility.set", { item: item.id, visible });
}
function setEdge(item: DockItem, event: Event) {
  const edge = parseDockEdge((event.target as HTMLSelectElement).value);
  if (edge) emit("command", "ide.workbench.dock.item.place", { item: item.id, edge });
}
function setAlign(item: DockItem, event: Event) {
  const align = parseDockAlign((event.target as HTMLSelectElement).value);
  if (align)
    emit("command", "ide.workbench.dock.item.place", { item: item.id, edge: item.edge, align });
}
function caption(item: DockItem): string {
  return catalog.layout.isHidden(item.id)
    ? "скрыт"
    : `${dockEdgeTitles[item.edge]}, ${dockAlignTitles[item.align].toLowerCase()}`;
}
</script>

<template>
  <footer class="status-bar" @dragenter="dragOver" @dragover="dragOver" @drop.stop="dropOnBar">
    <DockItems
      edge="bottom"
      align="start"
      :inbox="inbox"
      @command="(id, args) => emit('command', id, args)"
    />
    <span class="status-spacer" />
    <DockItems
      edge="bottom"
      align="end"
      :inbox="inbox"
      @command="(id, args) => emit('command', id, args)"
    />
    <span :ref="menu.trigger" class="status-settings"
      ><UiButton
        shape="icon"
        size="sm"
        title="Настроить элементы панелей"
        aria-label="Настроить элементы панелей"
        aria-haspopup="dialog"
        :aria-expanded="menu.open.value"
        data-command="ide.workbench.dock.settings.toggle"
        @click="commands.run('ide.workbench.dock.settings.toggle')"
        ><ProjectorIcon name="sliders-horizontal" aria-hidden="true" /></UiButton
    ></span>
    <UiIsland :menu="menu" label="Настройка элементов панелей" :width="340">
      <UiIslandHeader class="island-head" aria-label="Закрыть" @click="menu.toggle(false)">
        <span>Элементы панелей</span><ProjectorIcon name="sliders-horizontal" aria-hidden="true" />
      </UiIslandHeader>
      <p v-if="catalog.layout.error.value" class="config-error" role="alert">
        {{ catalog.layout.error.value }}
      </p>
      <UiIslandLabel divided>Индикаторы</UiIslandLabel>
      <div class="config-list" role="group" aria-label="Индикаторы">
        <div
          v-for="item in usage"
          :key="item.id"
          class="config-row"
          :class="{ off: catalog.layout.isHidden(item.id) }"
          :data-item="item.id"
        >
          <ProjectorIcon :name="item.icon" aria-hidden="true" />
          <span class="config-copy">
            <span class="config-name">{{ item.title }}</span>
            <span class="config-caption">{{ caption(item) }}</span>
          </span>
          <button
            type="button"
            class="config-eye"
            :aria-pressed="!catalog.layout.isHidden(item.id)"
            :title="
              catalog.layout.isHidden(item.id)
                ? `Показать «${item.title}»`
                : `Скрыть «${item.title}»`
            "
            data-command="ide.workbench.dock.item.visibility.set"
            @click="setVisible(item, catalog.layout.isHidden(item.id))"
          >
            <ProjectorIcon
              :name="catalog.layout.isHidden(item.id) ? 'eye-off' : 'eye'"
              aria-hidden="true"
            />
          </button>
          <select
            class="edge-select"
            :value="item.edge"
            :aria-label="`Где показывать «${item.title}»`"
            data-command="ide.workbench.dock.item.place"
            @change="setEdge(item, $event)"
          >
            <option v-for="edge in DOCK_EDGES" :key="edge" :value="edge">
              {{ dockEdgeTitles[edge] }}
            </option>
          </select>
          <select
            class="align-select"
            :value="item.align"
            :aria-label="`Выравнивание «${item.title}»`"
            data-command="ide.workbench.dock.item.place"
            @change="setAlign(item, $event)"
          >
            <option v-for="align in DOCK_ALIGNS" :key="align" :value="align">
              {{ dockAlignTitles[align] }}
            </option>
          </select>
        </div>
      </div>
      <UiIslandLabel divided>Кнопки и виджеты</UiIslandLabel>
      <div class="config-list" role="group" aria-label="Кнопки и виджеты">
        <div
          v-for="item in actions"
          :key="item.id"
          class="config-row"
          :class="{ off: catalog.layout.isHidden(item.id) }"
          :data-item="item.id"
        >
          <ProjectorIcon :name="item.icon" aria-hidden="true" />
          <span class="config-copy">
            <span class="config-name">{{ item.title }}</span>
            <span class="config-caption">{{ caption(item) }}</span>
          </span>
          <button
            type="button"
            class="config-eye"
            :aria-pressed="!catalog.layout.isHidden(item.id)"
            :title="
              catalog.layout.isHidden(item.id)
                ? `Показать «${item.title}»`
                : `Скрыть «${item.title}»`
            "
            data-command="ide.workbench.dock.item.visibility.set"
            @click="setVisible(item, catalog.layout.isHidden(item.id))"
          >
            <ProjectorIcon
              :name="catalog.layout.isHidden(item.id) ? 'eye-off' : 'eye'"
              aria-hidden="true"
            />
          </button>
          <select
            class="edge-select"
            :value="item.edge"
            :aria-label="`Где показывать «${item.title}»`"
            data-command="ide.workbench.dock.item.place"
            @change="setEdge(item, $event)"
          >
            <option v-for="edge in DOCK_EDGES" :key="edge" :value="edge">
              {{ dockEdgeTitles[edge] }}
            </option>
          </select>
          <select
            class="align-select"
            :value="item.align"
            :aria-label="`Выравнивание «${item.title}»`"
            data-command="ide.workbench.dock.item.place"
            @change="setAlign(item, $event)"
          >
            <option v-for="align in DOCK_ALIGNS" :key="align" :value="align">
              {{ dockAlignTitles[align] }}
            </option>
          </select>
        </div>
      </div>
      <UiIslandFooter> Перетащите элемент в шапку или нижнюю строку </UiIslandFooter>
    </UiIsland>
  </footer>
</template>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 24px;
  padding-inline: var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-2xs);
  user-select: none;
}
.status-spacer {
  flex: 1;
  min-width: var(--sp-2);
}
.status-settings {
  display: inline-flex;
  flex-shrink: 0;
}
.status-settings :deep(svg) {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.config-list {
  display: flex;
  flex-direction: column;
}
.config-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 4px var(--sp-2);
  border-radius: var(--r-md);
}
.config-row:hover {
  background: var(--hover);
}
.config-row.off {
  color: var(--muted);
}
.config-row > svg,
.config-eye svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.config-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.config-name {
  color: var(--text);
  font-size: var(--fs-xs);
}
.config-caption {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.config-off .config-name,
.config-row.off .config-name {
  color: var(--muted);
}
.config-eye {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  color: var(--muted);
}
.config-eye:hover,
.config-eye:focus-visible {
  border-color: var(--line-strong);
  color: var(--text);
}
.edge-select,
.align-select {
  flex-shrink: 0;
  max-width: 76px;
  padding: 2px 4px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg-3);
  color: var(--text);
  font: inherit;
}
.edge-select:focus-visible,
.align-select:focus-visible {
  border-color: var(--focus);
  outline: none;
}
.config-error {
  margin: var(--sp-2);
  color: var(--err);
}
@media (max-width: 600px) {
  .status-bar {
    flex-wrap: wrap;
    gap: 6px;
    padding-inline: 6px;
  }
  .status-spacer {
    display: none;
  }
  .status-bar :deep(.quota-bar:not(.tooltip-bar)) {
    min-width: 64px;
  }
}
</style>
