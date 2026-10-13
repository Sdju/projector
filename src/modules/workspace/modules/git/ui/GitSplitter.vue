<script setup lang="ts">
import { ref, watch, onScopeDispose } from "vue";
import { useResizeObserver } from "@vueuse/core";
import UiResizeHandle from "../../../../../common/ui/UiResizeHandle.vue";
import { usePointerDrag } from "../../../../../common/utilities/pointer-drag.ts";
import { resizeHistory, HISTORY_MIN, CHANGES_MIN } from "../lib/git-split.ts";

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
const measuredHeight = ref(0);
const measuredMaximum = ref(HISTORY_MIN);
let measureFrame: number | undefined;
const updateHeight = () => {
  measuredHeight.value = props.target?.offsetHeight ?? 0;
  measuredMaximum.value = Math.max(HISTORY_MIN, (props.stack?.offsetHeight ?? 0) - CHANGES_MIN);
};
watch(() => [props.target, props.stack], updateHeight, { immediate: true });
useResizeObserver(
  () => [props.target, props.stack],
  () => {
    if (measureFrame !== undefined) return;
    measureFrame = requestAnimationFrame(() => {
      measureFrame = undefined;
      updateHeight();
    });
  },
);
onScopeDispose(() => {
  if (measureFrame !== undefined) cancelAnimationFrame(measureFrame);
});
const STEP = 24;
const measure = () => ({
  height: props.target?.offsetHeight ?? 0,
  stack: props.stack?.offsetHeight ?? 0,
});
function apply(height: number, stack: number, delta: number) {
  const result = resizeHistory(height, stack, delta);
  if (result.collapse) {
    drag.stop();
    emit("collapse");
  } else emit("resize", result.height);
}
const drag = usePointerDrag({
  start: (event) => ({ height: measure().height, y: event.clientY }),
  move: (event, start) => apply(start.height, measure().stack, event.clientY - start.y),
});
const { dragging, start: down } = drag;
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
  <UiResizeHandle
    appearance="line"
    class="splitter"
    :dragging="dragging"
    aria-label="Граница между изменениями и историей"
    :aria-valuenow="measuredHeight"
    aria-valuemin="0"
    :aria-valuemax="measuredMaximum"
    :aria-valuetext="`${measuredHeight} px`"
    title="Потяните, чтобы изменить высоту истории · если сжать до минимума, она сворачивается · двойной клик возвращает размер"
    tabindex="0"
    @pointerdown="down"
    @dblclick="emit('reset')"
    @keydown="key"
  />
</template>
