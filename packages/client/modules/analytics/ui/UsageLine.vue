<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

const props = withDefaults(
  defineProps<{
    points: { label: string; value: number }[];
    height?: number;
    format?: (value: number) => string;
    color?: string;
    ariaLabel?: string;
  }>(),
  { height: 160, color: "var(--info)" },
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
const pad = computed(() => ({ l: 42, r: 12, t: 12, b: 20 }));
const innerWidth = computed(() => Math.max(20, width.value - pad.value.l - pad.value.r));
const innerHeight = computed(() => Math.max(20, height.value - pad.value.t - pad.value.b));

function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const scaled = value / power;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * power;
}

const max = computed(() => niceMax(Math.max(0, ...props.points.map((point) => point.value))));
const ticks = computed(() => [0, 0.5, 1].map((part) => part * max.value));
const x = (index: number) =>
  pad.value.l +
  (props.points.length <= 1
    ? innerWidth.value / 2
    : (index / (props.points.length - 1)) * innerWidth.value);
const y = (value: number) =>
  pad.value.t + innerHeight.value - (value / max.value) * innerHeight.value;

const line = computed(() =>
  props.points.map((point, index) => `${x(index)},${y(point.value)}`).join(" "),
);
const area = computed(() => {
  if (!props.points.length) return "";
  const first = x(0);
  const last = x(props.points.length - 1);
  const bottom = pad.value.t + innerHeight.value;
  return `${first},${bottom} ${line.value} ${last},${bottom}`;
});

const labelIndexes = computed(() => {
  const count = props.points.length;
  if (count <= 12) return props.points.map((_, index) => index);
  const keep = new Set([0, count - 1]);
  const every = Math.ceil(count / 6);
  for (let index = every; index < count - 1; index += every) keep.add(index);
  return [...keep].sort((a, b) => a - b);
});
const empty = computed(() => props.points.every((point) => !point.value));
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
        <polygon v-if="!empty" :points="area" :fill="color" opacity="0.12" />
        <polyline v-if="!empty" :points="line" :stroke="color" class="line" />
        <circle
          v-for="(point, index) in points"
          v-show="!empty"
          :key="`${point.label}-${index}`"
          :cx="x(index)"
          :cy="y(point.value)"
          r="2.5"
          :fill="color"
        >
          <title>{{ point.label }}: {{ format(point.value) }}</title>
        </circle>
        <g class="x-labels">
          <text
            v-for="index in labelIndexes"
            :key="index"
            :x="x(index)"
            :y="height - 5"
            text-anchor="middle"
          >
            {{ points[index]?.label ?? "" }}
          </text>
        </g>
      </svg>
      <p v-if="empty" class="empty">Значения появятся, когда у ответов будет цена</p>
    </div>
  </div>
</template>

<style scoped>
.chart {
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
.line {
  fill: none;
  stroke-width: 1.8;
  vector-effect: non-scaling-stroke;
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
