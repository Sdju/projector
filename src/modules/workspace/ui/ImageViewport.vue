<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { fitImage, zoomImageAt, type ImageTransform } from "../lib/image-viewport.ts";
import IconRatio from "~icons/lucide/ratio";
import IconMaximize from "~icons/lucide/maximize";
const props = withDefaults(
  defineProps<{
    src: string;
    alt: string;
    width?: number;
    height?: number;
    identity?: string;
    fit?: boolean;
    background?: string;
    backgroundColor?: string;
    backgroundControls?: boolean;
    error?: string;
  }>(),
  { fit: true, background: "checker", backgroundColor: "#808080", backgroundControls: true },
);
const localBackground = ref(props.background);
const localBackgroundColor = ref(props.backgroundColor);
const canvasBackground = computed(() =>
  props.backgroundControls ? localBackground.value : props.background,
);
const canvasBackgroundColor = computed(() =>
  props.backgroundControls ? localBackgroundColor.value : props.backgroundColor,
);
const canvas = ref<HTMLElement>();
const natural = ref({ width: 0, height: 0 });
const view = ref<ImageTransform>({ zoom: 1, x: 0, y: 0 });
const failed = ref(false);
const panning = ref(false);
const dimensions = computed(() => ({
  width: props.width ?? natural.value.width,
  height: props.height ?? natural.value.height,
}));
const imageStyle = computed(() => ({
  width: `${dimensions.value.width}px`,
  height: `${dimensions.value.height}px`,
  transform: `translate(-50%, -50%) translate(${view.value.x}px, ${view.value.y}px) scale(${view.value.zoom})`,
}));
let initialized = false;
let observer: ResizeObserver | undefined;
let pointerId: number | undefined;
let drag = { clientX: 0, clientY: 0, x: 0, y: 0 };
let zoomStopUntil = 0;
function reset(fit = props.fit) {
  const element = canvas.value;
  const { width, height } = dimensions.value;
  if (!element || !width || !height || !element.clientWidth || !element.clientHeight) {
    initialized = false;
    return;
  }
  view.value = {
    zoom: fit ? fitImage(width, height, element.clientWidth, element.clientHeight) : 1,
    x: 0,
    y: 0,
  };
  initialized = true;
  zoomStopUntil = 0;
}
function loaded(event: Event) {
  const image = event.target as HTMLImageElement;
  natural.value = { width: image.naturalWidth, height: image.naturalHeight };
  if (!initialized) reset();
}
function wheel(event: WheelEvent) {
  const element = canvas.value;
  if (!element || props.error || failed.value) return;
  const now = performance.now();
  if (now < zoomStopUntil) return;
  const rect = element.getBoundingClientRect();
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
  const delta = Math.max(-500, Math.min(500, (event.deltaY || event.deltaX) * unit));
  const previousZoom = view.value.zoom;
  view.value = zoomImageAt(
    view.value,
    view.value.zoom * Math.exp(-delta * 0.002),
    event.clientX - rect.left - rect.width / 2,
    event.clientY - rect.top - rect.height / 2,
  );
  // Briefly hold the detent so touchpad momentum cannot immediately skip it.
  if (previousZoom !== 1 && view.value.zoom === 1) zoomStopUntil = now + 180;
}
function startPan(event: PointerEvent) {
  if (event.button !== 0 || !event.isPrimary || props.error || failed.value) return;
  event.preventDefault();
  const element = event.currentTarget as HTMLElement;
  element.focus({ preventScroll: true });
  element.setPointerCapture(event.pointerId);
  pointerId = event.pointerId;
  drag = { clientX: event.clientX, clientY: event.clientY, x: view.value.x, y: view.value.y };
  panning.value = true;
}
function movePan(event: PointerEvent) {
  if (!panning.value || event.pointerId !== pointerId) return;
  view.value = {
    ...view.value,
    x: drag.x + event.clientX - drag.clientX,
    y: drag.y + event.clientY - drag.clientY,
  };
}
function endPan(event: PointerEvent) {
  if (event.pointerId !== pointerId) return;
  panning.value = false;
  const element = event.currentTarget as HTMLElement;
  if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
  pointerId = undefined;
}
function key(event: KeyboardEvent) {
  if (!["+", "=", "-", "0", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key))
    return;
  event.preventDefault();
  if (event.key === "0") reset();
  else if (["+", "=", "-"].includes(event.key))
    view.value = zoomImageAt(
      view.value,
      view.value.zoom * (event.key === "-" ? 1 / 1.2 : 1.2),
      0,
      0,
    );
  else {
    const step = event.shiftKey ? 100 : 30;
    view.value = {
      ...view.value,
      x: view.value.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0),
      y: view.value.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0),
    };
  }
}
watch(
  () => props.src,
  () => {
    failed.value = false;
  },
);
watch(
  () => props.identity ?? props.src,
  () => {
    initialized = false;
    natural.value = { width: 0, height: 0 };
    view.value = { zoom: 1, x: 0, y: 0 };
  },
);
onMounted(() => {
  observer = new ResizeObserver(() => {
    if (!initialized) reset();
  });
  if (canvas.value) observer.observe(canvas.value);
});
onBeforeUnmount(() => observer?.disconnect());
defineExpose({ reset });
</script>

<template>
  <section class="image-viewport" aria-label="Просмотр изображения">
    <div
      ref="canvas"
      class="image-canvas"
      :class="[canvasBackground, { panning }]"
      :style="canvasBackground === 'custom' ? { background: canvasBackgroundColor } : undefined"
      role="region"
      aria-label="Область изображения"
      tabindex="0"
      @wheel.prevent="wheel"
      @pointerdown="startPan"
      @pointermove="movePan"
      @pointerup="endPan"
      @pointercancel="endPan"
      @lostpointercapture="
        panning = false;
        pointerId = undefined;
      "
      @dblclick="reset()"
      @keydown="key"
      @dragstart.prevent
    >
      <p v-if="error || failed" class="error" role="alert">
        {{ error || "Браузер не смог отобразить это изображение." }}
      </p>
      <img
        v-else
        :src="src"
        :alt="alt"
        :style="imageStyle"
        draggable="false"
        @load="loaded"
        @error="failed = true"
      />
    </div>
    <div class="view-controls">
      <span>{{ Math.round(view.zoom * 100) }}%</span>
      <button
        @click="reset(false)"
        aria-label="Сбросить масштаб"
        title="Масштаб 100% и центрирование изображения"
      >
        <IconRatio aria-hidden="true" />
      </button>
      <button
        @click="reset(true)"
        aria-label="Вписать"
        title="Вписать изображение в область просмотра"
      >
        <IconMaximize aria-hidden="true" />
      </button>
      <label v-if="backgroundControls" class="background-control"
        >Фон
        <select v-model="localBackground" aria-label="Фон изображения">
          <option value="light">Светлый</option>
          <option value="dark">Тёмный</option>
          <option value="checker">Шашечки</option>
          <option value="gradient">Градиент</option>
          <option value="color-gradient">Цветной градиент</option>
          <option value="custom">Свой цвет</option>
        </select>
      </label>
      <input
        v-if="backgroundControls && localBackground === 'custom'"
        v-model="localBackgroundColor"
        type="color"
        aria-label="Свой цвет фона изображения"
      />
    </div>
  </section>
</template>

<style scoped>
.image-viewport {
  height: 100%;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.image-canvas {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  user-select: none;
  overscroll-behavior: contain;
}
.image-canvas.panning {
  cursor: grabbing;
}
.image-canvas:focus-visible {
  outline: 1px solid var(--focus, #a0b7aa);
  outline-offset: -1px;
}
.image-canvas img {
  position: absolute;
  left: 50%;
  top: 50%;
  max-width: none;
  max-height: none;
  transform-origin: center;
  pointer-events: none;
}
.view-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 5px 12px;
  font-size: 11px;
  border-top: 1px solid var(--line);
}
.view-controls button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  cursor: pointer;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 2px 6px;
}
.view-controls button svg {
  width: 15px;
  height: 15px;
}
.view-controls button:hover {
  background: #3a3934;
}
.background-control {
  display: flex;
  align-items: center;
  gap: 6px;
}
.background-control select {
  font: inherit;
  color: var(--text, #d8d2c4);
  background: var(--surface, #171716);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 2px 6px;
}
.view-controls input[type="color"] {
  width: 28px;
  height: 24px;
  padding: 2px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}
.light {
  background: #f5f5f4;
}
.dark {
  background: #18181b;
}
.checker {
  background-color: #e4e4e7;
  background-image: conic-gradient(#b4b4bb 25%, transparent 0 50%, #b4b4bb 0 75%, transparent 0);
  background-size: 20px 20px;
}
.gradient {
  background: linear-gradient(135deg, #fafafa, #18181b);
}
.color-gradient {
  background: linear-gradient(135deg, #c4b5fd, #7dd3fc 50%, #fda4af);
}
.error {
  margin: 16px;
  padding: 12px;
  border-radius: 6px;
  color: var(--err);
  background: #171716;
  font-size: 13px;
  cursor: default;
}
</style>
