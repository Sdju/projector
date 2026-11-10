<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { niceMax, useChartLayout } from "../utilities/chart-layout.ts";

/**
 * Shared line chart. The widget uses the interactive brush/minimap/tooltip mode; analytics uses
 * the light area mode. Both read the same axes, scale and label thinning.
 */
const props = withDefaults(
  defineProps<{
    labels: string[];
    series: { name: string; data: number[] }[];
    height?: number;
    format?: (value: number) => string;
    ariaLabel?: string;
    color?: string;
    colors?: string[];
    interactive?: boolean;
    area?: boolean;
    legend?: boolean;
    emptyText?: string;
  }>(),
  {
    height: 160,
    color: "var(--info)",
    interactive: false,
    area: false,
    legend: undefined,
    emptyText: "",
  },
);

const palette = ["var(--info)", "var(--run)", "var(--warn)", "var(--err)"];
const host = ref<HTMLElement>();
const svgEl = ref<SVGSVGElement>();
const n = computed(() => Math.max(1, props.labels?.length ?? 1));
const empty = computed(
  () =>
    (props.labels?.length ?? 0) === 0 ||
    (props.series ?? []).every((item) => (item.data ?? []).every((value) => !value)),
);
const showEmpty = computed(() => Boolean(props.emptyText) && empty.value);
const format = (value: number) =>
  props.format?.(value) ??
  (Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ","));
const colorOf = (index: number) =>
  props.colors?.[index] ??
  (index === 0 ? props.color : undefined) ??
  palette[index % palette.length];

const rawMax = computed(() => {
  const values = props.series?.flatMap((item) => item?.data ?? []) ?? [];
  return Math.max(0, ...values);
});
const { width, pad, innerWidth, innerHeight, max, ticks, labelIndexes, y } = useChartLayout({
  host,
  height: () => props.height,
  maxValue: () => rawMax.value,
  labelsCount: () => props.labels?.length ?? 0,
  left: () => 12 + String(format(niceMax(rawMax.value))).length * 5.5,
  right: props.interactive ? 18 : 12,
});

const lo = ref(0);
const hi = ref(Math.max(1, n.value - 1));
const span = computed(() => Math.max(1e-6, hi.value - lo.value));
const hoverIndex = ref<number | null>(null);
const resetView = () => {
  lo.value = 0;
  hi.value = Math.max(1, n.value - 1);
};
watch(
  () => props.labels?.length,
  () => {
    resetView();
    hoverIndex.value = null;
  },
);

const xFull = (index: number) =>
  pad.value.l + (n.value <= 1 ? innerWidth.value / 2 : (index / (n.value - 1)) * innerWidth.value);
const x = (index: number) => {
  if (!props.interactive || n.value <= 1) return xFull(index);
  return pad.value.l + ((index - lo.value) / span.value) * innerWidth.value;
};

const drawable = computed(() => (showEmpty.value ? [] : (props.series ?? [])));
const lines = computed(() =>
  drawable.value.map((item, index) => {
    const data = (item.data ?? []).slice(0, n.value);
    return {
      key: `${item.name}:${index}`,
      name: item.name,
      color: colorOf(index),
      points: data.map((value, at) => `${x(at)},${y(value)}`).join(" "),
      dots: data.map((value, at) => ({ cx: x(at), cy: y(value) })),
    };
  }),
);
const areaPoints = computed(() => {
  const first = lines.value[0];
  if (!first?.points) return "";
  const data = (props.series?.[0]?.data ?? []).slice(0, n.value);
  const start = x(0);
  const end = x(Math.max(0, data.length - 1));
  const bottom = pad.value.t + innerHeight.value;
  return `${start},${bottom} ${first.points} ${end},${bottom}`;
});
const areaColor = computed(() => colorOf(0));
const showLegend = computed(() => props.legend ?? props.interactive);

const xLabelIndexes = computed(() => {
  if (!props.interactive) return labelIndexes.value;
  const visible = labelIndexes.value.filter(
    (index) => index >= lo.value - 0.001 && index <= hi.value + 0.001,
  );
  if (visible.length) return visible;
  const start = Math.round(lo.value);
  const end = Math.round(hi.value);
  return start === end ? [start] : [start, end];
});

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
  return (event.clientX - rect.left) * (width.value / rect.width);
}

function indexFromX(vbX: number): number {
  const ratio = (vbX - pad.value.l) / (innerWidth.value || 1);
  const idx = lo.value + ratio * span.value;
  return Math.min(n.value - 1, Math.max(0, Math.round(idx)));
}

function fullIndexFromX(vbX: number): number {
  const ratio = (vbX - pad.value.l) / (innerWidth.value || 1);
  return Math.min(n.value - 1, Math.max(0, Math.round(ratio * (n.value - 1))));
}

function onMove(event: PointerEvent) {
  if (!props.interactive) return;
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
  if (!props.interactive || n.value <= 1) return;
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
  if (!props.interactive || n.value <= 1) return;
  event.preventDefault();
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
  if (!props.interactive || n.value <= 1) return;
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
  const deltaIdx = ((vbX - miniDragStart.value.x) / (innerWidth.value || 1)) * (n.value - 1);
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

const miniH = 44;
const miniRect = computed(() => {
  const left = xFull(lo.value);
  const right = xFull(hi.value);
  return { x: left, width: Math.max(2, right - left) };
});
const miniLines = computed(() =>
  (props.series ?? []).map((item, index) => ({
    key: `${item.name}:${index}`,
    name: item.name,
    color: colorOf(index),
    points: (item.data ?? [])
      .slice(0, n.value)
      .map((value, at) => `${xFull(at)},${4 + (1 - value / max.value) * (miniH - 8)}`)
      .join(" "),
  })),
);

const hoveredPoint = computed(() => {
  if (!props.interactive || hoverIndex.value === null) return null;
  const idx = hoverIndex.value;
  const labels = props.labels ?? [];
  const series = props.series ?? [];
  if (idx < 0 || idx >= labels.length) return null;
  return {
    index: idx,
    label: labels[idx],
    values: series.map((item, index) => ({
      name: item.name,
      value: item.data?.[idx],
      color: colorOf(index),
    })),
    x: x(idx),
    y: y(series[0]?.data?.[idx] ?? 0),
  };
});

const tooltipStyle = computed(() => {
  if (!hoveredPoint.value) return {};
  const point = hoveredPoint.value;
  const left = Math.min(82, (point.x / width.value) * 100);
  const top = Math.max(0, (point.y / props.height) * 100 - 12);
  return { left: `${left}%`, top: `${top}%` };
});
</script>

<template>
  <figure
    ref="host"
    :class="interactive ? 'line' : 'chart'"
    :data-swipe-ignore="interactive ? '' : undefined"
  >
    <div v-if="interactive" class="toolbar">
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
      :viewBox="`0 0 ${width} ${height}`"
      :preserveAspectRatio="interactive ? undefined : 'none'"
      :style="interactive ? undefined : { height: `${height}px` }"
      :aria-label="ariaLabel"
      :aria-hidden="ariaLabel ? undefined : true"
      role="img"
      @pointermove="onMove"
      @pointerdown="onDown"
      @pointerup="onUp"
      @pointercancel="onCancel"
      @pointerleave="onLeave"
      @wheel="onWheel"
    >
      <g v-for="(tick, index) in ticks" :key="`${tick}:${index}`">
        <line :x1="pad.l" :x2="width - pad.r" :y1="y(tick)" :y2="y(tick)" class="grid" />
        <text :x="pad.l - 6" :y="y(tick) + 3" class="axis" text-anchor="end">
          {{ format(tick) }}
        </text>
      </g>
      <text
        v-for="index in xLabelIndexes"
        :key="`x:${index}`"
        :x="x(index)"
        :y="height - 6"
        class="axis"
        text-anchor="middle"
      >
        {{ labels[index] }}
      </text>
      <polygon
        v-if="area && !showEmpty && areaPoints"
        :points="areaPoints"
        :fill="areaColor"
        opacity="0.12"
      />
      <polyline
        v-for="item in lines"
        :key="item.key"
        :points="item.points"
        :stroke="item.color"
        fill="none"
        stroke-width="2"
        stroke-linejoin="round"
      />
      <g v-for="item in lines" :key="`${item.key}-dots`" :fill="item.color">
        <circle
          v-for="(dot, at) in item.dots"
          :key="at"
          :cx="dot.cx"
          :cy="dot.cy"
          :r="interactive && hoverIndex === at ? 4.5 : 2.5"
          :opacity="!interactive || hoverIndex === null || hoverIndex === at ? 1 : 0.35"
        />
      </g>
      <line
        v-if="interactive && hoveredPoint"
        :x1="hoveredPoint.x"
        :x2="hoveredPoint.x"
        :y1="pad.t"
        :y2="pad.t + innerHeight"
        class="guide"
      />
      <rect
        v-if="interactive && isBrushing"
        :x="Math.min(brushStart, brushEnd)"
        :y="pad.t"
        :width="Math.abs(brushEnd - brushStart)"
        :height="innerHeight"
        class="brush"
      />
    </svg>
    <svg
      v-if="interactive && showMinimap"
      class="minimap"
      :viewBox="`0 0 ${width} ${miniH}`"
      role="img"
      @pointerdown="onMiniDown"
      @pointermove="onMiniMove"
      @pointerup="onMiniUp"
      @pointercancel="onMiniUp"
      @pointerleave="onMiniUp"
    >
      <polyline
        v-for="item in miniLines"
        :key="item.key"
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
    <div v-if="interactive && hoveredPoint" class="tooltip" :style="tooltipStyle">
      <div class="tt-label">{{ hoveredPoint.label }}</div>
      <div v-for="(value, index) in hoveredPoint.values" :key="index" class="tt-row">
        <i :style="{ background: value.color }" />{{ value.name }}:
        <strong>{{ value.value === undefined ? "—" : format(value.value) }}</strong>
      </div>
    </div>
    <figcaption v-if="showLegend && lines.length">
      <span v-for="item in lines" :key="item.key"
        ><i :style="{ background: item.color }" />{{ item.name }}</span
      >
    </figcaption>
    <p v-if="showEmpty" class="empty">{{ emptyText }}</p>
  </figure>
</template>

<style scoped>
.line,
.chart {
  position: relative;
  min-width: 0;
  margin: 0;
}
.line {
  user-select: none;
}
svg {
  display: block;
  width: 100%;
}
.line svg {
  height: auto;
  cursor: crosshair;
  touch-action: none;
}
.chart svg {
  overflow: visible;
}
.grid {
  stroke: var(--line);
  stroke-dasharray: 2 4;
}
.axis {
  fill: var(--muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.guide {
  stroke: var(--muted);
  stroke-width: 1;
  stroke-dasharray: 3 3;
  opacity: 0.7;
}
figcaption {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-3);
  align-items: center;
  color: var(--text-2);
  font-size: var(--fs-2xs);
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
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--bg-3);
  padding: 2px 6px;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}
.tool.active {
  border-color: var(--info);
  background: var(--info);
  color: var(--bg);
}
.tooltip {
  position: absolute;
  z-index: 3;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--bg-3);
  padding: 4px 8px;
  box-shadow: var(--shadow-popover);
  font-size: 11px;
  white-space: nowrap;
  pointer-events: none;
}
.tt-label {
  margin-bottom: 2px;
  font-weight: 600;
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
  stroke: var(--info);
  stroke-width: 1;
  opacity: 0.18;
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
  stroke: var(--info);
  stroke-width: 1;
  opacity: 0.15;
  cursor: grab;
}
.empty {
  position: absolute;
  inset: 0 0 0 42px;
  display: grid;
  place-items: center;
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-xs);
  pointer-events: none;
}
</style>
