<script setup lang="ts">
import UiResizeHandle from "../../../../../common/ui/UiResizeHandle.vue";
import { computed, defineAsyncComponent, ref } from "vue";
import { usePointerDrag } from "../../../../../common/utilities/pointer-drag.ts";
import type { CommitComparison } from "../../../../../../core/modules/workspace/index.ts";
import { shortHash } from "../../../../../common/utilities/commit-format.ts";

const CodeViewer = defineAsyncComponent(() => import("./CodeViewer.vue"));
const props = defineProps<{
  comparison: CommitComparison;
  path: string;
  /** Запомненная высота: возвращается, когда файл раскрывают снова. */
  height?: number;
}>();
const emit = defineEmits<{ resize: [height: number]; collapse: [] }>();

const MIN = 100;
/** Ниже этой высоты при перетаскивании файл сворачивается, как блоки Staged и Changed. */
const COLLAPSE = 60;
const maxHeight = () => Math.round(window.innerHeight * 0.85);
/** Короткий файл не занимает лишнего места; длинный получает до 420px. */
const initial = () => {
  const { original, modified } = props.comparison;
  const lines = Math.max(original.split("\n").length, modified.split("\n").length);
  return Math.min(420, Math.max(MIN + 10, lines * 20 + 76));
};
const current = ref(props.height ?? initial());
let startHeight = 0;
const unchanged = computed(() => props.comparison.original === props.comparison.modified);

/** Возвращает false, если размер ушёл за порог и файл свёрнут. */
function setHeight(raw: number) {
  if (raw < COLLAPSE) {
    // Запоминается размер до схлопывания, а не порог.
    emit("resize", current.value);
    emit("collapse");
    drag.stop();
    return false;
  }
  current.value = Math.min(maxHeight(), Math.max(MIN, raw));
  emit("resize", current.value);
  return true;
}
const drag = usePointerDrag({
  start: (event) => {
    startHeight = current.value;
    return { height: current.value, y: event.clientY };
  },
  move: (event, start) => setHeight(start.height + event.clientY - start.y),
  finish: (reason, start) => {
    if (reason === "cancel") {
      current.value = start.height;
      emit("resize", start.height);
    }
  },
});
const { dragging, start } = drag;
function key(event: KeyboardEvent) {
  if (!["ArrowUp", "ArrowDown", "Home", "End", "Escape"].includes(event.key)) return;
  event.preventDefault();
  if (event.key === "Escape") {
    if (dragging.value) {
      current.value = startHeight;
      emit("resize", startHeight);
    }
    drag.stop();
  } else if (event.key === "Home") setHeight(0);
  else if (event.key === "End") setHeight(maxHeight());
  else setHeight(current.value + (event.shiftKey ? 96 : 24) * (event.key === "ArrowDown" ? 1 : -1));
}
function reset() {
  current.value = initial();
  emit("resize", current.value);
}
</script>

<template>
  <p v-if="unchanged" class="note">Содержимое не изменилось.</p>
  <div v-else class="file-diff" :class="{ dragging }">
    <div :id="`diff-${path}`" class="viewer" :style="{ height: `${current}px` }">
      <CodeViewer
        :path="path"
        :content="comparison.modified"
        :original="comparison.original"
        :original-label="comparison.parent || '∅'"
        :modified-label="shortHash(comparison.hash)"
      />
    </div>
    <UiResizeHandle
      class="resize"
      :aria-label="`Высота кода: ${path}`"
      :aria-valuenow="current"
      :aria-valuemin="MIN"
      :aria-valuemax="maxHeight()"
      :aria-valuetext="`${current} px`"
      :aria-controls="`diff-${path}`"
      title="Высота кода · если сжать до минимума, файл сворачивается · двойной клик возвращает размер"
      tabindex="0"
      @pointerdown="start"
      @dblclick="reset"
      @keydown="key"
    />
  </div>
</template>

<style scoped>
.note {
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
  border-top: 1px solid var(--line);
  font-size: var(--fs-xs);
  color: var(--muted);
}
.viewer {
  min-width: 0;
  overflow: hidden;
  border-top: 1px solid var(--line);
}
.file-diff.dragging,
.file-diff.dragging * {
  cursor: row-resize !important;
  user-select: none;
}
</style>
