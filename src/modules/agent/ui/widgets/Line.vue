<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps<{
  labels: string[];
  series: { name: string; data: number[] }[];
  height?: number;
}>();
const colors = ["var(--info)", "var(--run)", "var(--warn)", "var(--err)"];
// The viewBox follows the real width, so axis text keeps its size in a narrow column too.
const host = ref<HTMLElement>();
const W = ref(480);
let observer: ResizeObserver | undefined;
onMounted(() => {
  if (!host.value || typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver(([entry]) => {
    const width = Math.round(entry?.contentRect.width ?? 0);
    if (width > 120) W.value = width;
  });
  observer.observe(host.value);
});
onBeforeUnmount(() => observer?.disconnect());
const H = computed(() => props.height ?? 160);
const max = computed(() => Math.max(1, ...props.series.flatMap((item) => item.data)));
// The left margin follows the widest tick label (about 5.5 units per digit at 9px).
const pad = computed(() => ({
  l: 12 + String(Math.round(max.value)).length * 5.5,
  r: 18,
  t: 10,
  b: 22,
}));

const x = (index: number) =>
  pad.value.l +
  (index / Math.max(1, props.labels.length - 1)) * (W.value - pad.value.l - pad.value.r);
const y = (value: number) =>
  pad.value.t + (1 - value / max.value) * (H.value - pad.value.t - pad.value.b);
const lines = computed(() =>
  props.series.map((item, index) => ({
    name: item.name,
    color: colors[index % colors.length],
    points: item.data.map((value, at) => `${x(at)},${y(value)}`).join(" "),
    dots: item.data.map((value, at) => ({ cx: x(at), cy: y(value) })),
  })),
);
const ticks = computed(() => [0, 0.5, 1].map((part) => Math.round(max.value * part)));
</script>

<template>
  <figure ref="host" class="line">
    <svg :viewBox="`0 0 ${W} ${H}`" role="img">
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
        <circle v-for="(dot, at) in item.dots" :key="at" :cx="dot.cx" :cy="dot.cy" r="2.5" />
      </g>
    </svg>
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
}
svg {
  width: 100%;
  height: auto;
}
.grid {
  stroke: var(--line);
}
.axis {
  fill: var(--muted);
  font-size: 9px;
}
figcaption {
  display: flex;
  gap: var(--sp-3);
  font-size: var(--fs-2xs);
  color: var(--text-2);
}
i {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 5px;
  border-radius: 50%;
}
</style>
