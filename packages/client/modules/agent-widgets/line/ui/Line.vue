<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{
  labels: string[];
  series: { name: string; data: number[] }[];
  height?: number;
}>();
const colors = ["var(--info)", "var(--run)", "var(--warn)", "var(--err)"];
const host = ref<HTMLElement>();
const svgEl = ref<SVGSVGElement>();
const W = ref(480);
let observer: ResizeObserver | undefined;
onMounted(() => {
  if (!host.value || typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver(([entry]) => {
    const width = Math.round(entry?.contentRect.width ?? 0);
    if (width > 120) requestAnimationFrame(() => (W.value = width));
  });
  observer.observe(host.value);
});
onBeforeUnmount(() => observer?.disconnect());

const H = computed(() => props.height ?? 160);
const n = computed(() => Math.max(1, props.labels?.length ?? 1));
const max = computed(() => {
  const all = props.series?.flatMap((item) => item?.data ?? []) ?? [];
  return Math.max(1, ...all);
});
const pad = computed(() => ({
  l: 12 + String(Math.round(max.value)).length * 5.5,
  r: 18,
  t: 10,
  b: 22,
}));

const lo = ref(0);
const hi = ref(Math.max(1, (props.labels?.length ?? 1) - 1));
const resetView = () => {
  lo.value = 0;
  hi.value = Math.max(1, (props.labels?.length ?? 1) - 1);
};
watch(
  () => props.labels?.length,
  () => resetView(),
);

const span = computed(() => Math.max(1e-6, hi.value - lo.value));
const x = (index: number) =>
  pad.value.l + ((index - lo.value) / span.value) * (W.value - pad.value.l - pad.value.r);
const y = (value: number) =>
  pad.value.t + (1 - value / max.value) * (H.value - pad.value.t - pad.value.b);

const lines = computed(() =>
  (props.series ?? []).map((item, index) => ({
    name: item.name,
    color: colors[index % colors.length],
    points: (item.data ?? []).map((value, at) => `${x(at)},${y(value)}`).join(" "),
    dots: (item.data ?? []).map((value, at) => ({ cx: x(at), cy: y(value) })),
  })),
);
const ticks = computed(() => [0, 0.5, 1].map((part) => Math.round(max.value * part)));
const miniH = 44;
const miniRect = computed(() => {
  const left = xFull(lo.value);
  const right = xFull(hi.value);
  return { x: left, width: Math.max(2, right - left) };
});
const xFull = (index: number) => {
  const inner = W.value - pad.value.l - pad.value.r;
  const nPts = Math.max(1, (props.labels?.length ?? 1) - 1);
  return pad.value.l + (index / nPts) * inner;
};

const hoverIndex = ref<number | null>(null);
const showMinimap = ref(false);
const isBrushing = ref(false);
const brushStart = ref(0);
const brushEnd = ref(0);
const miniDragging = ref(false);
const miniDragStart = ref<{ x: number; lo: number; hi: number } | null>(null);

function viewBoxX(
  event: { clientX: number },
  element: SVGSVGElement | null = svgEl.value ?? null,
): number {
  const rect = element?.getBoundingClientRect();
  if (!rect || rect.width === 0) return 0;
  return (event.clientX - rect.left) * (W.value / rect.width);
}

function indexFromX(vbX: number): number {
  const inner = W.value - pad.value.l - pad.value.r;
  const ratio = (vbX - pad.value.l) / (inner || 1);
  const idx = lo.value + ratio * span.value;
  return Math.min(n.value - 1, Math.max(0, Math.round(idx)));
}

function fullIndexFromX(vbX: number): number {
  const inner = W.value - pad.value.l - pad.value.r;
  const ratio = (vbX - pad.value.l) / (inner || 1);
  return Math.min(n.value - 1, Math.max(0, Math.round(ratio * (n.value - 1))));
}

function onMove(event: PointerEvent) {
  const vbX = viewBoxX(event);
  if (isBrushing.value) {
    brushEnd.value = vbX;
    return;
  }
  hoverIndex.value = indexFromX(vbX);
}

function onLeave() {
  if (!isBrushing.value) hoverIndex.value = null;
}

function onDown(event: PointerEvent) {
  if (n.value <= 1) return;
  const vbX = viewBoxX(event);
  isBrushing.value = true;
  brushStart.value = vbX;
  brushEnd.value = vbX;
  (event.currentTarget as Element)?.setPointerCapture?.(event.pointerId);
}

function onUp() {
  if (!isBrushing.value) return;
  const a = Math.min(brushStart.value, brushEnd.value);
  const b = Math.max(brushStart.value, brushEnd.value);
  if (b - a > 8) {
    const idxA = indexFromX(a);
    const idxB = indexFromX(b);
    const newLo = Math.min(idxA, idxB);
    const newHi = Math.max(idxA, idxB);
    if (newHi - newLo >= 1) {
      lo.value = newLo;
      hi.value = newHi;
    }
  }
  isBrushing.value = false;
}

function onCancel() {
  isBrushing.value = false;
  hoverIndex.value = null;
}

function onWheel(event: WheelEvent) {
  if (n.value <= 1) return;
  const vbX = viewBoxX(event);
  const center = indexFromX(vbX);
  const curSpan = span.value;
  const factor = event.deltaY > 0 ? 1.25 : 0.8;
  const newSpan = Math.min(n.value - 1, Math.max(1, curSpan * factor));
  const ratio = (center - lo.value) / curSpan;
  let newLo = center - ratio * newSpan;
  let newHi = newLo + newSpan;
  if (newLo < 0) {
    newLo = 0;
    newHi = newSpan;
  }
  if (newHi > n.value - 1) {
    newHi = n.value - 1;
    newLo = newHi - newSpan;
  }
  lo.value = Math.max(0, newLo);
  hi.value = Math.min(n.value - 1, Math.max(lo.value + 1e-6, newHi));
}

function onMiniDown(event: PointerEvent) {
  if (n.value <= 1) return;
  const svg = event.currentTarget as SVGSVGElement;
  const vbX = viewBoxX(event, svg);
  const rectLeft = xFull(lo.value);
  const rectRight = xFull(hi.value);
  if (vbX >= rectLeft && vbX <= rectRight) {
    miniDragging.value = true;
    miniDragStart.value = { x: vbX, lo: lo.value, hi: hi.value };
    svg.setPointerCapture?.(event.pointerId);
  } else {
    const center = fullIndexFromX(vbX);
    const s = hi.value - lo.value;
    let newLo = center - s / 2;
    let newHi = center + s / 2;
    if (newLo < 0) {
      newLo = 0;
      newHi = s;
    }
    if (newHi > n.value - 1) {
      newHi = n.value - 1;
      newLo = newHi - s;
    }
    lo.value = Math.max(0, newLo);
    hi.value = Math.min(n.value - 1, Math.max(lo.value + 1e-6, newHi));
  }
}

function onMiniMove(event: PointerEvent) {
  if (!miniDragging.value || !miniDragStart.value) return;
  const vbX = viewBoxX(event, event.currentTarget as SVGSVGElement);
  const inner = W.value - pad.value.l - pad.value.r;
  const deltaIdx = ((vbX - miniDragStart.value.x) / (inner || 1)) * (n.value - 1);
  const s = miniDragStart.value.hi - miniDragStart.value.lo;
  let newLo = miniDragStart.value.lo + deltaIdx;
  let newHi = newLo + s;
  if (newLo < 0) {
    newLo = 0;
    newHi = s;
  }
  if (newHi > n.value - 1) {
    newHi = n.value - 1;
    newLo = newHi - s;
  }
  lo.value = Math.max(0, newLo);
  hi.value = Math.min(n.value - 1, Math.max(lo.value + 1e-6, newHi));
}

function onMiniUp() {
  miniDragging.value = false;
  miniDragStart.value = null;
}

const miniLines = computed(() =>
  (props.series ?? []).map((item, index) => ({
    name: item.name,
    color: colors[index % colors.length],
    points: (item.data ?? [])
      .map((value, at) => `${xFull(at)},${4 + (1 - value / max.value) * (miniH - 8)}`)
      .join(" "),
  })),
);

const hoveredPoint = computed(() => {
  if (hoverIndex.value === null) return null;
  const idx = hoverIndex.value;
  const labels = props.labels ?? [];
  const series = props.series ?? [];
  if (idx < 0 || idx >= labels.length) return null;
  return {
    index: idx,
    label: labels[idx],
    values: series.map((s, i) => ({
      name: s.name,
      value: s.data?.[idx],
      color: colors[i % colors.length],
    })),
    x: x(idx),
    y: y(series[0]?.data?.[idx] ?? 0),
  };
});

const tooltipStyle = computed(() => {
  if (!hoveredPoint.value) return {};
  const hp = hoveredPoint.value;
  const left = Math.min(82, (hp.x / W.value) * 100);
  const top = Math.max(0, (hp.y / H.value) * 100 - 12);
  return { left: `${left}%`, top: `${top}%` };
});
</script>

<template>
  <figure ref="host" class="line" data-swipe-ignore>
    <div class="toolbar">
      <button
        type="button"
        class="tool"
        :class="{ active: showMinimap }"
        title="Миникарта"
        @click="showMinimap = !showMinimap"
      >
        Карта
      </button>
      <button type="button" class="tool" title="Сбросить масштаб" @click="resetView()">↺</button>
    </div>
    <svg
      ref="svgEl"
      :viewBox="`0 0 ${W} ${H}`"
      role="img"
      @pointermove="onMove"
      @pointerdown="onDown"
      @pointerup="onUp"
      @pointercancel="onCancel"
      @pointerleave="onLeave"
      @wheel.prevent="onWheel"
    >
      <g v-for="tick in ticks" :key="tick">
        <line :x1="pad.l" :x2="W - pad.r" :y1="y(tick)" :y2="y(tick)" class="grid" />
        <text :x="pad.l - 6" :y="y(tick) + 3" class="axis" text-anchor="end">{{ tick }}</text>
      </g>
      <text
        v-for="(label, index) in labels"
        :key="label"
        :x="x(index)"
        :y="H - 6"
        class="axis"
        text-anchor="middle"
      >
        {{ label }}
      </text>
      <polyline
        v-for="item in lines"
        :key="item.name"
        :points="item.points"
        :stroke="item.color"
        fill="none"
        stroke-width="2"
        stroke-linejoin="round"
      />
      <g v-for="item in lines" :key="`${item.name}-dots`" :fill="item.color">
        <circle
          v-for="(dot, at) in item.dots"
          :key="at"
          :cx="dot.cx"
          :cy="dot.cy"
          :r="hoverIndex === at ? 4.5 : 2.5"
          :opacity="hoverIndex === null || hoverIndex === at ? 1 : 0.35"
        />
      </g>
      <line
        v-if="hoveredPoint"
        :x1="hoveredPoint.x"
        :x2="hoveredPoint.x"
        :y1="pad.t"
        :y2="H - pad.b"
        class="guide"
      />
      <rect
        v-if="isBrushing"
        :x="Math.min(brushStart, brushEnd)"
        :y="pad.t"
        :width="Math.abs(brushEnd - brushStart)"
        :height="H - pad.t - pad.b"
        class="brush"
      />
    </svg>
    <svg
      v-if="showMinimap"
      class="minimap"
      :viewBox="`0 0 ${W} ${miniH}`"
      role="img"
      @pointerdown="onMiniDown"
      @pointermove="onMiniMove"
      @pointerup="onMiniUp"
      @pointercancel="onMiniUp"
      @pointerleave="onMiniUp"
    >
      <polyline
        v-for="item in miniLines"
        :key="item.name"
        :points="item.points"
        :stroke="item.color"
        fill="none"
        stroke-width="1.5"
        stroke-linejoin="round"
        opacity="0.6"
      />
      <rect
        :x="miniRect.x"
        y="2"
        :width="miniRect.width"
        :height="miniH - 4"
        class="mini-viewport"
      />
    </svg>
    <div v-if="hoveredPoint" class="tooltip" :style="tooltipStyle">
      <div class="tt-label">{{ hoveredPoint.label }}</div>
      <div v-for="v in hoveredPoint.values" :key="v.name" class="tt-row">
        <i :style="{ background: v.color }" />{{ v.name }}: <strong>{{ v.value }}</strong>
      </div>
    </div>
    <figcaption>
      <span v-for="item in lines" :key="item.name"
        ><i :style="{ background: item.color }" />{{ item.name }}</span
      >
    </figcaption>
  </figure>
</template>

<style scoped>
.line {
  margin: 0;
  position: relative;
  user-select: none;
}
svg {
  width: 100%;
  height: auto;
  cursor: crosshair;
  touch-action: none;
}
.grid {
  stroke: var(--line);
}
.axis {
  fill: var(--muted);
  font-size: 9px;
}
.guide {
  stroke: var(--muted);
  stroke-width: 1;
  stroke-dasharray: 3 3;
  opacity: 0.7;
}
figcaption {
  display: flex;
  gap: var(--sp-3);
  font-size: var(--fs-2xs);
  color: var(--text-2);
  flex-wrap: wrap;
  align-items: center;
}
i {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 5px;
  border-radius: 50%;
}
.toolbar {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 2;
}
.tool {
  background: var(--surface-2, rgba(0, 0, 0, 0.05));
  border: 1px solid var(--line);
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  padding: 2px 6px;
}
.tool.active {
  background: var(--info);
  color: #fff;
  border-color: var(--info);
}
.tooltip {
  position: absolute;
  pointer-events: none;
  background: var(--surface, #fff);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 11px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 3;
  white-space: nowrap;
}
.tt-label {
  font-weight: 600;
  margin-bottom: 2px;
}
.tt-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tooltip i {
  width: 6px;
  height: 6px;
}
.brush {
  fill: var(--info);
  opacity: 0.18;
  stroke: var(--info);
  stroke-width: 1;
}
.minimap {
  width: 100%;
  height: auto;
  margin-top: 4px;
  cursor: pointer;
  touch-action: none;
}
.mini-viewport {
  fill: var(--info);
  opacity: 0.15;
  stroke: var(--info);
  stroke-width: 1;
  cursor: grab;
}
</style>
