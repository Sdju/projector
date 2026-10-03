<script setup lang="ts">
import { computed } from "vue";
import type { GraphRow } from "../../../../../../core/modules/workspace/index.ts";

const props = defineProps<{
  row: GraphRow;
  /** Число колонок графа во всём списке: ячейки соседних строк выравниваются. */
  columns: number;
  height: number;
  /** Коммит не отправлен в upstream: узел рисуется пустым. */
  hollow?: boolean;
  merge?: boolean;
}>();
const STEP = 10;
const PAD = 7;
const palette = ["var(--accent)", "var(--run)", "var(--warn)", "var(--err)", "var(--muted)"];
const x = (column: number) => PAD + Math.min(column, props.columns - 1) * STEP;
const color = (column: number) => palette[column % palette.length]!;
const mid = computed(() => props.height / 2);
const width = computed(() => PAD * 2 + (props.columns - 1) * STEP);
function curve(from: number, to: number, down: boolean) {
  const y0 = down ? mid.value : 0;
  const y1 = down ? props.height : mid.value;
  if (from === to) return `M${x(from)} ${y0}V${y1}`;
  const control = (y0 + y1) / 2;
  return `M${x(from)} ${y0}C${x(from)} ${control} ${x(to)} ${control} ${x(to)} ${y1}`;
}
</script>

<template>
  <svg
    class="graph"
    :width="width"
    :height="height"
    :viewBox="`0 0 ${width} ${height}`"
    aria-hidden="true"
  >
    <path
      v-for="column in row.through"
      :key="`t${column}`"
      :d="`M${x(column)} 0V${height}`"
      :stroke="color(column)"
    />
    <path
      v-for="column in row.joins"
      :key="`j${column}`"
      :d="curve(column, row.column, false)"
      :stroke="color(column)"
    />
    <path
      v-for="column in row.forks"
      :key="`f${column}`"
      :d="curve(row.column, column, true)"
      :stroke="color(column)"
    />
    <circle
      :cx="x(row.column)"
      :cy="mid"
      :r="merge ? 3 : 3.5"
      :stroke="color(row.column)"
      :fill="hollow ? 'var(--bg)' : color(row.column)"
      :class="{ merge }"
    />
  </svg>
</template>

<style scoped>
.graph {
  flex-shrink: 0;
  display: block;
}
path {
  fill: none;
  stroke-width: 1.5;
}
circle {
  stroke-width: 1.5;
}
circle.merge {
  stroke-width: 2.5;
  fill: var(--bg);
}
</style>
