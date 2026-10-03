<script setup lang="ts">
import { ref } from "vue";
import { resizeHistory } from "../lib/git-split.ts";

/**
 * Граница между изменениями и историей. Движение вверх увеличивает историю; если сжать её
 * до минимума, она сворачивается. Двойной клик возвращает высоту по содержимому.
 */
const props = defineProps<{
  /** Блок истории: из него читается текущая высота. */
  target: HTMLElement | undefined;
  /** Контейнер обеих зон. */
  stack: HTMLElement | undefined;
}>();
const emit = defineEmits<{ resize: [height: number]; collapse: []; reset: [] }>();
const STEP = 24;
const dragging = ref(false);
let startY = 0;
let startHeight = 0;
const measure = () => ({
  height: props.target?.offsetHeight ?? 0,
  stack: props.stack?.offsetHeight ?? 0,
});
function apply(height: number, stack: number, delta: number) {
  const result = resizeHistory(height, stack, delta);
  if (result.collapse) {
    dragging.value = false;
    emit("collapse");
  } else emit("resize", result.height);
}
function down(event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  const handle = event.currentTarget as HTMLElement;
  handle.focus();
  handle.setPointerCapture(event.pointerId);
  startHeight = measure().height;
  startY = event.clientY;
  dragging.value = true;
}
function move(event: PointerEvent) {
  if (dragging.value) apply(startHeight, measure().stack, event.clientY - startY);
}
function up(event: PointerEvent) {
  dragging.value = false;
  const handle = event.currentTarget as HTMLElement;
  if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
}
function key(event: KeyboardEvent) {
  if (!["ArrowUp", "ArrowDown", "Home", "End", "Enter"].includes(event.key)) return;
  event.preventDefault();
  const { height, stack } = measure();
  if (event.key === "Enter") emit("reset");
  else if (event.key === "Home") emit("collapse");
  else if (event.key === "End") apply(height, stack, -stack);
  else apply(height, stack, (event.shiftKey ? 4 : 1) * STEP * (event.key === "ArrowUp" ? -1 : 1));
}
</script>

<template>
  <div
    class="splitter"
    :class="{ dragging }"
    role="separator"
    aria-orientation="horizontal"
    aria-label="Граница между изменениями и историей"
    :aria-valuenow="Math.round(target?.offsetHeight ?? 0)"
    aria-valuemin="0"
    title="Потяните, чтобы изменить высоту истории · если сжать до минимума, она сворачивается · двойной клик возвращает размер"
    tabindex="0"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="up"
    @lostpointercapture="dragging = false"
    @dblclick="emit('reset')"
    @keydown="key"
  />
</template>

<style scoped>
.splitter {
  flex: none;
  position: relative;
  height: 9px;
  margin-block: -4px;
  z-index: 2;
  cursor: row-resize;
  touch-action: none;
  user-select: none;
}
.splitter::before {
  content: "";
  position: absolute;
  inset: 4px 0;
  background: var(--line);
}
.splitter:hover::before,
.splitter:focus-visible::before,
.splitter.dragging::before {
  inset: 3px 0;
  background: var(--faint);
}
.splitter:focus-visible {
  outline: none;
}
</style>
