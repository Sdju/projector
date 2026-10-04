<script setup lang="ts">
import { computed, inject, ref } from "vue";
import {
  isNodeVisible,
  setSplitSizes,
  type DockNode as DockNodeData,
  type DockSplit,
} from "../model/layout.ts";
import { dockKey } from "./context.ts";
import DockGroupView from "./DockGroupView.vue";

defineOptions({ name: "DockTree" });
const props = defineProps<{ node: DockNodeData }>();
const dock = inject(dockKey)!;
const element = ref<HTMLElement>();
const split = computed(() => (props.node.type === "split" ? props.node : undefined));
const visibleChildren = computed(() => split.value?.children.filter(isNodeVisible) ?? []);
const row = computed(() => split.value?.direction === "row");
const minimum = computed(() => (row.value ? 140 : 100));
const sizeOf = (node: DockNodeData) =>
  split.value!.sizes[split.value!.children.indexOf(node)] ?? 1 / split.value!.children.length;
const visibleShare = computed(() =>
  visibleChildren.value.reduce((sum, child) => sum + sizeOf(child), 0),
);

/** Сдвигает границу перед видимым ребёнком `index`, перераспределяя долю между соседями. */
function moveSash(index: number, start: [number, number], delta: number) {
  const parent = split.value as DockSplit;
  const before = visibleChildren.value[index - 1]!;
  const after = visibleChildren.value[index]!;
  const total = start[0] + start[1];
  const first = Math.max(minimum.value, Math.min(start[0] + delta, total - minimum.value));
  const sizes = [...parent.sizes];
  const left = parent.children.indexOf(before);
  const right = parent.children.indexOf(after);
  const share = sizes[left]! + sizes[right]!;
  sizes[left] = (share * first) / total;
  sizes[right] = share - sizes[left]!;
  dock.update(setSplitSizes(dock.layout(), parent.id, sizes));
}
function cellSizes(index: number): [number, number] {
  const cells = element.value!.querySelectorAll<HTMLElement>(":scope > .dock-cell");
  const side = row.value ? "width" : "height";
  return [
    cells[index - 1]!.getBoundingClientRect()[side],
    cells[index]!.getBoundingClientRect()[side],
  ];
}

let drag: { index: number; origin: number; start: [number, number] } | undefined;
function sashDown(event: PointerEvent, index: number) {
  if (event.button !== 0) return;
  const target = event.currentTarget as HTMLElement;
  event.preventDefault();
  target.focus();
  target.setPointerCapture(event.pointerId);
  drag = { index, origin: row.value ? event.clientX : event.clientY, start: cellSizes(index) };
  document.body.style.cursor = row.value ? "col-resize" : "row-resize";
  document.body.style.userSelect = "none";
}
function sashMove(event: PointerEvent) {
  if (!drag) return;
  moveSash(drag.index, drag.start, (row.value ? event.clientX : event.clientY) - drag.origin);
}
function sashUp() {
  drag = undefined;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
}
function sashKey(event: KeyboardEvent, index: number) {
  const keys = row.value ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
  const direction = keys.indexOf(event.key);
  if (direction === -1) return;
  event.preventDefault();
  moveSash(index, cellSizes(index), (direction ? 1 : -1) * 24);
}
</script>

<template>
  <DockGroupView v-if="node.type === 'group'" :group="node" />
  <div v-else ref="element" class="dock-split" :class="split!.direction">
    <template v-for="(child, index) in visibleChildren" :key="child.id">
      <div
        v-if="index"
        class="dock-sash"
        :class="split!.direction"
        role="separator"
        :aria-orientation="row ? 'vertical' : 'horizontal'"
        :aria-label="row ? 'Ширина блока' : 'Высота блока'"
        tabindex="0"
        @pointerdown="sashDown($event, index)"
        @pointermove="sashMove"
        @pointerup="sashUp"
        @pointercancel="sashUp"
        @keydown="sashKey($event, index)"
      />
      <div class="dock-cell" :style="{ flex: `${sizeOf(child) / visibleShare} 1 0` }">
        <DockTree :node="child" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.dock-split {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.dock-split.row {
  flex-direction: row;
}
.dock-split.column {
  flex-direction: column;
}
.dock-cell {
  display: flex;
  min-width: 0;
  min-height: 0;
}
.row > .dock-cell {
  min-width: 140px;
}
.column > .dock-cell {
  min-height: 100px;
}
/* Видимая линия 1px, зона захвата шире за счёт ::before */
.dock-sash {
  position: relative;
  z-index: 1;
  flex: none;
  background: var(--line);
  touch-action: none;
  transition: background var(--t-fast);
}
.dock-sash.row {
  width: 1px;
  cursor: col-resize;
}
.dock-sash.column {
  height: 1px;
  cursor: row-resize;
}
.dock-sash::before {
  content: "";
  position: absolute;
}
.dock-sash.row::before {
  inset: 0 -4px;
}
.dock-sash.column::before {
  inset: -4px 0;
}
.dock-sash:hover,
.dock-sash:active {
  background: var(--line-strong);
}
.dock-sash:focus-visible {
  outline: none;
  background: var(--focus);
}
@media (max-width: 700px) {
  .dock-split.row {
    flex-direction: column;
  }
  .dock-split > .dock-cell {
    flex: none !important;
    min-height: 0;
    height: max(360px, calc(100dvh - 180px));
  }
  .dock-split.row,
  .dock-split.column {
    flex-direction: column;
  }
  .row > .dock-cell {
    min-width: 0;
  }
  .dock-sash {
    display: none;
  }
}
@media (min-width: 701px) and (max-width: 1050px) {
  .dock-split.row,
  .dock-split.column {
    flex-direction: column;
  }
  .dock-split > .dock-cell {
    flex: none !important;
    min-width: 0;
    min-height: 0;
    height: clamp(360px, 65dvh, 720px);
  }
  .dock-sash {
    display: none;
  }
}
</style>
