<script setup lang="ts">
import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";
import ContextMenu from "../../../common/ui/ContextMenu.vue";
import type { ContextMenuItem } from "../../../common/ui/context-menu.ts";
import { computed, inject, ref } from "vue";
import { useActionDrag } from "../lib/action-drag.ts";
import {
  DOCK_MIME,
  dockDragging,
  endDockDrag,
  type DockAlign,
  type DockEdge,
} from "../lib/dock-layout.ts";
import {
  DOCK_CELL_PREFIX,
  DOCK_CELLS,
  dockCellId,
  useDockCatalog,
  type DockItem,
} from "../lib/dock-items.ts";

/**
 * Ячейки одной группы панели. Виджеты телепортируются сюда из постоянного DockWidgets;
 * лента отвечает только за их порядок, перенос и контекстное меню.
 */
const props = withDefaults(
  defineProps<{
    edge: DockEdge;
    align: DockAlign;
    inbox?: boolean;
  }>(),
  { inbox: true },
);
const emit = defineEmits<{ command: [id: string, args?: unknown] }>();
const catalog = useDockCatalog();
const prefix = inject(DOCK_CELL_PREFIX, "dock");
const cells = inject(DOCK_CELLS);
const cellRefs = new Map<string, (element: unknown) => void>();
function cellRef(item: string) {
  let callback = cellRefs.get(item);
  if (!callback) {
    callback = (element) => {
      if (!cells) return;
      if (element instanceof HTMLElement) {
        if (cells.value.get(item) === element) return;
        const next = new Map(cells.value);
        next.set(item, element);
        cells.value = next;
      } else if (cells.value.has(item)) {
        const next = new Map(cells.value);
        next.delete(item);
        cells.value = next;
      }
    };
    cellRefs.set(item, callback);
  }
  return callback;
}
const items = computed(() =>
  catalog.itemsFor(props.edge, {
    align: props.align,
    inbox: props.inbox,
  }),
);

const dragging = dockDragging;
const alignmentTarget = computed(() => {
  const item = dragging.value;
  return (
    !!item && (catalog.edgeOfItem(item) !== props.edge || catalog.alignOfItem(item) !== props.align)
  );
});
const { dropTarget, dragStart, dragOver, dragLeave, drop, endDrag } = useActionDrag<string, string>(
  {
    dragging,
    axis: "x",
    mime: DOCK_MIME,
    sourceFor: (id) => id,
    canDrop: (from, to) => from !== to,
    move: (from, to, after) => {
      if (catalog.edgeOfItem(from) !== props.edge || catalog.alignOfItem(from) !== props.align) {
        emit("command", "ide.workbench.dock.item.place", {
          item: from,
          edge: props.edge,
          align: props.align,
        });
        return;
      }
      emit("command", "ide.workbench.dock.item.move", {
        edge: props.edge,
        align: props.align,
        from,
        to,
        after,
      });
    },
  },
);

function containerDragOver(event: DragEvent) {
  if (!dragging.value) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}
function containerDrop(event: DragEvent) {
  const item = dragging.value;
  if (!item) return;
  event.preventDefault();
  emit("command", "ide.workbench.dock.item.place", {
    item,
    edge: props.edge,
    align: props.align,
  });
  endDockDrag();
}

const context = ref<InstanceType<typeof ContextMenu>>();
const target = ref<DockItem>();
function openContext(event: MouseEvent, item: DockItem) {
  target.value = item;
  void context.value?.open(event, event.currentTarget as HTMLElement);
}
const contextItems = computed<ContextMenuItem[]>(() => {
  const item = target.value;
  if (!item) return [];
  const other: DockEdge = props.edge === "top" ? "bottom" : "top";
  return [
    {
      id: `place-${other}`,
      label: other === "top" ? "Наверх" : "Вниз",
      icon: other === "top" ? "arrow-up" : "arrow-down",
      command: "ide.workbench.dock.item.place",
      args: { item: item.id, edge: other },
      run: () => emit("command", "ide.workbench.dock.item.place", { item: item.id, edge: other }),
    },
    {
      id: "hide",
      label: "Скрыть",
      icon: "eye-off",
      separator: true,
      command: "ide.workbench.dock.item.visibility.set",
      args: { item: item.id, visible: false },
      run: () =>
        emit("command", "ide.workbench.dock.item.visibility.set", {
          item: item.id,
          visible: false,
        }),
    },
  ];
});
</script>

<template>
  <div
    class="dock-items"
    :class="{ 'edge-top': edge === 'top', 'alignment-target': alignmentTarget }"
    :data-edge="edge"
    :data-align="align"
    :title="alignmentTarget ? `Переместить ${align === 'start' ? 'влево' : 'вправо'}` : undefined"
    aria-label="Элементы панели"
    @dragover="containerDragOver"
    @drop.stop="containerDrop"
  >
    <ProjectorIcon
      v-if="alignmentTarget"
      class="alignment-icon"
      :name="align === 'start' ? 'arrow-left' : 'arrow-right'"
      aria-hidden="true"
    />
    <span
      v-for="item in items"
      :key="item.id"
      :id="dockCellId(prefix, item.id)"
      :ref="cellRef(item.id)"
      class="dock-item"
      :data-item="item.id"
      :class="{
        dragging: dragging === item.id,
        'drop-before': dropTarget?.id === item.id && !dropTarget.after,
        'drop-after': dropTarget?.id === item.id && dropTarget.after,
      }"
      draggable="true"
      @dragstart="dragStart($event, item.id)"
      @dragend="endDrag"
      @dragover.capture="dragOver($event, item.id)"
      @dragleave="dragLeave"
      @drop.capture.stop="drop($event, item.id)"
      @contextmenu="openContext($event, item)"
    />
  </div>
  <ContextMenu ref="context" :items="contextItems" label="Действия элемента" />
</template>

<style scoped>
.dock-items {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}
.dock-items.alignment-target {
  min-width: 28px;
  min-height: 26px;
  justify-content: center;
  padding-inline: 3px;
  border: 1px dashed var(--focus);
  border-radius: var(--r-md);
  color: var(--focus);
}
.alignment-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.dock-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  min-height: 24px;
}
.dock-item[draggable="true"] {
  cursor: grab;
}
.dock-item.dragging {
  opacity: 0.4;
}
.dock-item.drop-before::before,
.dock-item.drop-after::after {
  content: "";
  position: absolute;
  top: 1px;
  bottom: 1px;
  width: 2px;
  background: var(--focus);
  border-radius: 2px;
  pointer-events: none;
}
.dock-item.drop-before::before {
  left: -3px;
}
.dock-item.drop-after::after {
  right: -3px;
}
/* В шапке подсказка должна раскрываться вниз, иначе уходит за верхнее ребро окна. */
.dock-items.edge-top :deep(.quota-tooltip) {
  top: calc(100% + 7px);
  bottom: auto;
}
</style>
