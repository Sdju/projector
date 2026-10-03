<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from "vue";
import UiButton from "../../../../../common/ui/UiButton.vue";
import ImageViewport from "./ImageViewport.vue";
import IconRotateCcw from "~icons/lucide/rotate-ccw";
import { svgPreview } from "../lib/svg-preview.ts";
const CodeViewer = defineAsyncComponent(() => import("./CodeViewer.vue"));
const props = defineProps<{
  path: string;
  content: string;
  editable?: boolean;
  line?: number;
  column?: number;
}>();
const emit = defineEmits<{ change: [content: string]; save: [] }>();
const panes = ref<HTMLElement>();
const split = ref(0.45);
const lastSplit = ref(0.45);
const dragging = ref(false);
let dragStart = 0.45;
const rows = computed(() => ({
  gridTemplateRows: `minmax(0, ${split.value}fr) 12px minmax(0, ${1 - split.value}fr)`,
}));
const separatorTitle = computed(() =>
  split.value === 0
    ? "Рендер скрыт · потяните вниз или дважды нажмите для восстановления"
    : split.value === 1
      ? "Код скрыт · потяните вверх или дважды нажмите для восстановления"
      : "Соотношение высот рендера и кода · у краёв панель схлопывается · двойной клик восстанавливает",
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
const color = ref("#d8d2c4");
const size = ref(256);
const background = ref("checker");
const backgroundColor = ref("#808080");
const preview = computed(() => {
  try {
    return { ...svgPreview(props.content, color.value), error: "" };
  } catch (error) {
    return { url: "", width: 1, height: 1, error: String((error as Error).message) };
  }
});
watch(
  () => props.line,
  (line) => {
    if (line && split.value === 1) restoreSplit();
  },
);
const dimensions = computed(() => {
  const { width, height } = preview.value;
  const longest = Math.max(width, height);
  const pixels = Math.max(8, Math.min(2048, Number(size.value) || 256));
  return {
    width: Math.max(1, Math.round((pixels * width) / longest)),
    height: Math.max(1, Math.round((pixels * height) / longest)),
  };
});
function resetParameters() {
  color.value = "#d8d2c4";
  size.value = 256;
  background.value = "checker";
  backgroundColor.value = "#808080";
}
</script>

<template>
  <section class="svg-viewer" aria-label="Просмотр SVG">
    <div class="toolbar">
      <label class="color-control"
        >currentColor <input v-model="color" type="color" aria-label="Цвет currentColor" />
        <span>{{ color }}</span></label
      >
      <label class="size-control"
        >Размер
        <input
          v-model.number="size"
          type="range"
          min="8"
          max="2048"
          step="1"
          aria-label="Размер SVG"
        />
      </label>
      <input
        v-model.number="size"
        class="size-input"
        type="number"
        min="8"
        max="2048"
        step="1"
        aria-label="Произвольный размер SVG в пикселях"
        @change="size = Math.max(8, Math.min(2048, Math.round(Number(size) || 256)))"
      />
      <label
        >Фон
        <select v-model="background" aria-label="Фон SVG">
          <option value="light">Светлый</option>
          <option value="dark">Тёмный</option>
          <option value="checker">Шашечки</option>
          <option value="gradient">Градиент</option>
          <option value="color-gradient">Цветной градиент</option>
          <option value="custom">Свой цвет</option>
        </select></label
      >
      <input
        v-if="background === 'custom'"
        v-model="backgroundColor"
        type="color"
        aria-label="Свой цвет фона SVG"
      />
      <UiButton
        class="reset"
        icon
        size="sm"
        aria-label="Сбросить параметры SVG"
        title="Вернуть исходные currentColor, размер и фон SVG"
        @click="resetParameters"
      >
        <IconRotateCcw aria-hidden="true" />
      </UiButton>
    </div>
    <div ref="panes" class="panes" :class="{ dragging }" :style="rows">
      <div v-show="split > 0" id="svg-render-pane" class="render-pane">
        <div class="render-info">
          {{ dimensions.width }} × {{ dimensions.height }} px
          <span>Исходный: {{ Math.round(preview.width) }} × {{ Math.round(preview.height) }}</span>
        </div>
        <ImageViewport
          :src="preview.url"
          :alt="path"
          :identity="path"
          :width="dimensions.width"
          :height="dimensions.height"
          :fit="false"
          :background="background"
          :background-controls="false"
          :background-color="backgroundColor"
          :error="preview.error"
        />
      </div>
      <div
        class="pane-resize"
        role="separator"
        aria-label="Соотношение высот рендера и кода"
        aria-orientation="horizontal"
        :aria-valuenow="Math.round(split * 100)"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuetext="
          split === 0
            ? 'Рендер скрыт'
            : split === 1
              ? 'Код скрыт'
              : `Рендер ${Math.round(split * 100)}%, код ${Math.round((1 - split) * 100)}%`
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
        <span>{{ split === 0 ? "Рендер ▾" : split === 1 ? "Код ▴" : "" }}</span>
      </div>
      <div v-show="split < 1" id="svg-source-pane" class="source-pane">
        <CodeViewer
          :path="path"
          :content="content"
          :editable="editable"
          :line="line"
          :column="column"
          @change="emit('change', $event)"
          @save="emit('save')"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.svg-viewer {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sp-2) var(--sp-4);
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--line);
  font-size: var(--fs-xs);
}
.toolbar label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.toolbar select {
  width: auto;
  padding-block: var(--sp-1);
}
.size-control input[type="range"] {
  width: clamp(100px, 15vw, 180px);
}
.toolbar input[type="color"] {
  width: 28px;
  height: 26px;
  padding: 2px;
  background: transparent;
  cursor: pointer;
}
.color-control span {
  font-family: var(--mono);
}
.size-input {
  width: 72px;
  padding-block: var(--sp-1);
}
.reset {
  margin-left: auto;
}
.panes {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: grid;
}
.render-pane {
  grid-row: 1;
}
.source-pane {
  grid-row: 3;
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
.render-pane {
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.render-info {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-1) var(--sp-3);
  padding: 6px var(--sp-3);
  font-size: var(--fs-2xs);
  color: var(--muted);
  border-bottom: 1px solid var(--line);
}
.render-info span {
  margin-left: auto;
}
.source-pane {
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  border-top: 1px solid var(--line);
}
</style>
