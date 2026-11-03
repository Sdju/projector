<script setup lang="ts">
import UiResizeHandle from "../../../common/ui/UiResizeHandle.vue";
import { computed, inject, ref } from "vue";
import { usePointerDrag } from "../../../common/utilities/pointer-drag.ts";
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

let sashIndex = 0;
const drag = usePointerDrag({
  start: (event) => ({
    index: sashIndex,
    origin: row.value ? event.clientX : event.clientY,
    start: cellSizes(sashIndex),
  }),
  move: (event, state) =>
    moveSash(state.index, state.start, (row.value ? event.clientX : event.clientY) - state.origin),
  cursor: () => (row.value ? "col-resize" : "row-resize"),
});
function sashDown(event: PointerEvent, index: number) {
  sashIndex = index;
  drag.start(event);
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
      <UiResizeHandle
        v-if="index"
        appearance="gap"
        class="dock-sash"
        :class="split!.direction"
        :orientation="row ? 'vertical' : 'horizontal'"
        :aria-label="row ? 'Ширина блока' : 'Высота блока'"
        tabindex="0"
        @pointerdown="sashDown($event, index)"
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
    gap: var(--island-gap);
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
