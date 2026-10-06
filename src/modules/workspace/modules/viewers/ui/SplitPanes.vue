<script setup lang="ts">
import { computed, ref, watch } from "vue";
const props = defineProps<{ topLabel?: string; bottomLabel?: string; reveal?: unknown }>();
const panes = ref<HTMLElement>();
const split = ref(0.45);
const lastSplit = ref(0.45);
const dragging = ref(false);
let dragStart = 0.45;
const rows = computed(() => ({
  gridTemplateRows: `minmax(0, ${split.value}fr) 12px minmax(0, ${1 - split.value}fr)`,
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
function startResize(event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  const handle = event.currentTarget as HTMLElement;
  handle.focus();
  handle.setPointerCapture(event.pointerId);
  dragStart = split.value;
  if (split.value > 0 && split.value < 1) lastSplit.value = split.value;
  dragging.value = true;
}
function moveResize(event: PointerEvent) {
  if (!dragging.value || !panes.value) return;
  const rect = panes.value.getBoundingClientRect();
  setSplit((event.clientY - rect.top - 6) / Math.max(1, rect.height - 12));
}
function finishResize(event: PointerEvent) {
  dragging.value = false;
  const handle = event.currentTarget as HTMLElement;
  if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
}
function resizeKey(event: KeyboardEvent) {
  if (!["ArrowUp", "ArrowDown", "Home", "End", "Enter", "Escape"].includes(event.key)) return;
  event.preventDefault();
  if (event.key === "Escape") {
    if (dragging.value) split.value = dragStart;
    dragging.value = false;
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
    <div v-show="split > 0" class="top-pane"><slot name="top" /></div>
    <div
      class="pane-resize"
      role="separator"
      :aria-label="`Соотношение высот: ${lower(top)} / ${lower(bottom)}`"
      aria-orientation="horizontal"
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
      @pointermove="moveResize"
      @pointerup="finishResize"
      @pointercancel="
        split = dragStart;
        finishResize($event);
      "
      @lostpointercapture="dragging = false"
      @dblclick="restoreSplit"
      @keydown="resizeKey"
    >
      <span>{{ split === 0 ? `${top} ▾` : split === 1 ? `${bottom} ▴` : "" }}</span>
    </div>
    <div v-show="split < 1" class="bottom-pane"><slot name="bottom" /></div>
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
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  cursor: row-resize;
  touch-action: none;
  user-select: none;
  background: var(--bg-3);
  border-block: 1px solid var(--line);
  color: var(--text);
  font-size: var(--fs-2xs);
  line-height: var(--fs-2xs);
}
.pane-resize::before {
  content: "";
  width: 36px;
  height: 2px;
  border-radius: var(--r-sm);
  background: var(--faint);
}
.pane-resize:has(span:not(:empty))::before {
  display: none;
}
.pane-resize:hover,
.pane-resize:focus-visible {
  background: var(--bg-4);
  outline-offset: -2px;
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
