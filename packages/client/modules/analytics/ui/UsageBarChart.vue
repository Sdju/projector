<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

const props = withDefaults(
  defineProps<{
    points: { label: string; values: Record<string, number> }[];
    series: { key: string; label: string; color: string }[];
    height?: number;
    format?: (value: number) => string;
    ariaLabel?: string;
  }>(),
  { height: 180 },
);

const width = ref(560);
const host = ref<HTMLElement>();
let observer: ResizeObserver | undefined;
onMounted(() => {
  if (!host.value || typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver(([entry]) => {
    const next = Math.round(entry?.contentRect.width ?? 0);
    if (next > 160) width.value = next;
  });
  observer.observe(host.value);
});
onBeforeUnmount(() => observer?.disconnect());

const format = (value: number) => props.format?.(value) ?? String(Math.round(value));
const height = computed(() => props.height);
const pad = computed(() => ({ l: 42, r: 10, t: 12, b: 20 }));
const innerWidth = computed(() => Math.max(20, width.value - pad.value.l - pad.value.r));
const innerHeight = computed(() => Math.max(20, height.value - pad.value.t - pad.value.b));

/** Round the axis top up to 1, 2 or 5 with a power of ten. */
function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const scaled = value / power;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * power;
}

const totals = computed(() =>
  props.points.map((point) =>
    props.series.reduce((sum, item) => sum + Math.max(0, point.values[item.key] ?? 0), 0),
  ),
);
const max = computed(() => niceMax(Math.max(0, ...totals.value)));
const ticks = computed(() => [0, 0.5, 1].map((part) => part * max.value));
const step = computed(() => innerWidth.value / Math.max(1, props.points.length));
const barWidth = computed(() => Math.max(2, Math.min(28, step.value * 0.68)));

const bars = computed(() =>
  props.points.map((point, index) => {
    const center = pad.value.l + step.value * (index + 0.5);
    let bottom = 0;
    const segments = props.series.flatMap((item) => {
      const value = Math.max(0, point.values[item.key] ?? 0);
      if (!value) return [];
      const part = (value / max.value) * innerHeight.value;
      const segment = {
        key: `${item.key}-${index}`,
        x: center - barWidth.value / 2,
        y: pad.value.t + innerHeight.value - bottom - part,
        height: Math.max(0.5, part),
        color: item.color,
        title: `${point.label} · ${item.label}: ${format(value)}`,
      };
      bottom += part;
      return [segment];
    });
    return { center, segments, total: totals.value[index] ?? 0 };
  }),
);

const labelIndexes = computed(() => {
  const count = props.points.length;
  if (count <= 12) return props.points.map((_, index) => index);
  const keep = new Set([0, count - 1]);
  const every = Math.ceil(count / 6);
  for (let index = every; index < count - 1; index += every) keep.add(index);
  return [...keep].sort((a, b) => a - b);
});
const xLabel = (index: number) => props.points[index]?.label ?? "";
const y = (value: number) =>
  pad.value.t + innerHeight.value - (value / max.value) * innerHeight.value;
const empty = computed(() => totals.value.every((value) => value === 0));
</script>

<template>
  <div ref="host" class="chart">
    <div class="plot" :style="{ height: `${height}px` }">
      <svg
        :viewBox="`0 0 ${width} ${height}`"
        :aria-label="ariaLabel"
        role="img"
        preserveAspectRatio="none"
      >
        <g class="grid">
          <line
            v-for="tick in ticks"
            :key="tick"
            :x1="pad.l"
            :x2="width - pad.r"
            :y1="y(tick)"
            :y2="y(tick)"
          />
        </g>
        <g class="y-labels">
          <text v-for="tick in ticks" :key="tick" :x="pad.l - 6" :y="y(tick) + 3" text-anchor="end">
            {{ format(tick) }}
          </text>
        </g>
        <g class="bars">
          <g v-for="bar in bars" :key="bar.center">
            <rect
              v-for="segment in bar.segments"
              :key="segment.key"
              :x="segment.x"
              :y="segment.y"
              :width="barWidth"
              :height="segment.height"
              :fill="segment.color"
              rx="1"
            >
              <title>{{ segment.title }}</title>
            </rect>
          </g>
        </g>
        <g class="x-labels">
          <text
            v-for="index in labelIndexes"
            :key="index"
            :x="bars[index]?.center ?? 0"
            :y="height - 5"
            text-anchor="middle"
          >
            {{ xLabel(index) }}
          </text>
        </g>
      </svg>
      <p v-if="empty" class="empty">Нет ответов с токенами за этот период</p>
    </div>
    <ul class="legend">
      <li v-for="item in series" :key="item.key">
        <i :style="{ background: item.color }" />{{ item.label }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.chart {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.plot {
  position: relative;
  min-width: 0;
}
svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.grid line {
  stroke: var(--line);
  stroke-dasharray: 2 4;
}
.y-labels text,
.x-labels text {
  fill: var(--muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
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
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2) var(--sp-3);
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.legend li {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.legend i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}
</style>
