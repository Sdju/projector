import { computed, onBeforeUnmount, onMounted, ref, type Ref } from "vue";

/** Round the axis top up to 1, 2 or 5 with a power of ten. */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const scaled = value / power;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * power;
}

/** Keep the first and last label and a handful of evenly spaced ones. */
export function chartLabelIndexes(count: number, max = 6): number[] {
  if (count <= 12) return Array.from({ length: count }, (_, index) => index);
  const keep = new Set([0, count - 1]);
  const every = Math.ceil(count / max);
  for (let index = every; index < count - 1; index += every) keep.add(index);
  return [...keep].sort((a, b) => a - b);
}

/**
 * Measures the chart host and derives the scaled drawing box. `maxValue` belongs to the caller:
 * the bar chart takes the total of a point, the line chart the largest single point.
 */
export function useChartLayout(options: {
  host: Ref<HTMLElement | undefined>;
  height: () => number;
  maxValue: () => number;
  labelsCount: () => number;
  right?: number;
}) {
  const width = ref(560);
  const host = options.host;
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

  const height = computed(() => options.height());
  const pad = computed(() => ({ l: 42, r: options.right ?? 12, t: 12, b: 20 }));
  const innerWidth = computed(() => Math.max(20, width.value - pad.value.l - pad.value.r));
  const innerHeight = computed(() => Math.max(20, height.value - pad.value.t - pad.value.b));
  const max = computed(() => niceMax(options.maxValue()));
  const ticks = computed(() => [0, 0.5, 1].map((part) => part * max.value));
  const labelIndexes = computed(() => chartLabelIndexes(options.labelsCount()));
  const y = (value: number) =>
    pad.value.t + innerHeight.value - (value / max.value) * innerHeight.value;

  return { host, width, height, pad, innerWidth, innerHeight, max, ticks, labelIndexes, y };
}
