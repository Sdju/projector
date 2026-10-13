<script setup lang="ts">
import UiResizeHandle from "../../../../../common/ui/UiResizeHandle.vue";
import { computed, ref, watch } from "vue";
import { usePointerDrag } from "../../../../../common/utilities/pointer-drag.ts";
const props = withDefaults(
  defineProps<{
    topLabel?: string;
    bottomLabel?: string;
    reveal?: unknown;
    initial?: number;
    solo?: boolean;
  }>(),
  { initial: 0.45, solo: false },
);
const panes = ref<HTMLElement>();
const split = ref(props.initial);
const lastSplit = ref(props.initial);
let dragStart = props.initial;
const rows = computed(() => ({
  gridTemplateRows: props.solo
    ? "minmax(0, 1fr)"
    : `minmax(0, ${split.value}fr) 12px minmax(0, ${1 - split.value}fr)`,
}));
const top = computed(() => props.topLabel ?? "Рендер");
const bottom = computed(() => props.bottomLabel ?? "Код");
const lower = (text: string) => text.toLowerCase();
const separatorTitle = computed(() =>
  split.value === 0
    ? `${top.value} скрыт · потяните вниз или дважды нажмите для восстановления`
    : split.value === 1
      ? `${bottom.value} скрыт · потяните вверх или дважды нажмите для восстановления`
      : `Соотношение высот: ${lower(top.value)} / ${lower(bottom.value)} · у краёв панель схлопывается · двойной клик восстанавливает`,
);
function setSplit(value: number) {
  const next = value <= 0.1 ? 0 : value >= 0.9 ? 1 : value;
  if (next === 0 || next === 1) {
    if (!dragging.value && split.value > 0 && split.value < 1) lastSplit.value = split.value;
  }
  split.value = next;
}
function restoreSplit() {
  split.value = lastSplit.value;
}
const drag = usePointerDrag({
  start: () => {
    dragStart = split.value;
    if (split.value > 0 && split.value < 1) lastSplit.value = split.value;
    return dragStart;
  },
  move: (event) => {
    if (!panes.value) return;
    const rect = panes.value.getBoundingClientRect();
    setSplit((event.clientY - rect.top - 6) / Math.max(1, rect.height - 12));
  },
  finish: (reason, start) => {
    if (reason === "cancel") split.value = start;
  },
});
const { dragging, start: startResize } = drag;
function resizeKey(event: KeyboardEvent) {
  if (!["ArrowUp", "ArrowDown", "Home", "End", "Enter", "Escape"].includes(event.key)) return;
  event.preventDefault();
  if (event.key === "Escape") {
    if (dragging.value) split.value = dragStart;
    drag.stop();
  } else if (event.key === "Enter") restoreSplit();
  else if (event.key === "Home") setSplit(0);
  else if (event.key === "End") setSplit(1);
  else {
    const delta = event.shiftKey ? 0.1 : 0.05;
    // Leave the collapse zone in one key press when opening a hidden pane.
    const next = split.value + (event.key === "ArrowDown" ? delta : -delta);
    setSplit(split.value === 0 && next > 0 ? 0.15 : split.value === 1 && next < 1 ? 0.85 : next);
  }
}
// Something wants the collapsed bottom pane (a jump to a line): open it.
watch(
  () => props.reveal,
  (value) => {
    if (value && split.value === 1) restoreSplit();
  },
);
</script>

<template>
  <div ref="panes" class="panes" :class="{ dragging }" :style="rows">
    <div v-show="solo || split > 0" class="top-pane"><slot name="top" /></div>
    <UiResizeHandle
      v-show="!solo"
      :labelled="split === 0 || split === 1"
      class="pane-resize"
      :aria-label="`Соотношение высот: ${lower(top)} / ${lower(bottom)}`"
      :aria-valuenow="Math.round(split * 100)"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuetext="
        split === 0
          ? `${top} скрыт`
          : split === 1
            ? `${bottom} скрыт`
            : `${top} ${Math.round(split * 100)}%, ${lower(bottom)} ${Math.round((1 - split) * 100)}%`
      "
      :title="separatorTitle"
      tabindex="0"
      @pointerdown="startResize"
      @dblclick="restoreSplit"
      @keydown="resizeKey"
    >
      <span>{{ split === 0 ? `${top} ▾` : split === 1 ? `${bottom} ▴` : "" }}</span>
    </UiResizeHandle>
    <div v-show="!solo && split < 1" class="bottom-pane"><slot name="bottom" /></div>
  </div>
</template>

<style scoped>
.panes {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: grid;
}
.pane-resize {
  grid-row: 2;
  position: relative;
  color: var(--text);
  font-size: var(--fs-2xs);
  line-height: var(--fs-2xs);
}
.panes.dragging,
.panes.dragging * {
  cursor: row-resize !important;
  user-select: none;
}
.top-pane {
  grid-row: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.bottom-pane {
  grid-row: 3;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  border-top: 1px solid var(--line);
}
</style>
