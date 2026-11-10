<script setup lang="ts">
import UiLineChart from "../../../../common/ui/UiLineChart.vue";

defineProps<{
  labels: string[];
  series: { name: string; data: number[] }[];
  height?: number;
}>();
</script>

<template>
  <UiLineChart :labels="labels" :series="series" :height="height" interactive />
</template>
