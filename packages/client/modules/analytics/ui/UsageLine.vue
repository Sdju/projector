<script setup lang="ts">
import { computed } from "vue";
import UiLineChart from "../../../common/ui/UiLineChart.vue";

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

const labels = computed(() => props.points.map((point) => point.label));
const series = computed(() => [
  { name: "Стоимость", data: props.points.map((point) => point.value) },
]);
const empty = computed(() => props.points.every((point) => !point.value));
</script>

<template>
  <UiLineChart
    :labels="labels"
    :series="series"
    :height="height"
    :format="format"
    :color="color"
    :aria-label="ariaLabel"
    area
    :legend="false"
    :empty-text="empty ? 'Значения появятся, когда у ответов будет цена' : ''"
  />
</template>
