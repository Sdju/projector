<script setup lang="ts">
import UiMeter from "../../../../common/ui/UiMeter.vue";
import { computed } from "vue";

const props = defineProps<{ items: { label: string; value: number }[]; unit?: string }>();
const max = computed(() => Math.max(1, ...props.items.map((item) => item.value)));
</script>

<template>
  <ul class="bars">
    <li v-for="item in items" :key="item.label">
      <span class="label">{{ item.label }}</span>
      <UiMeter :value="(item.value / max) * 100" :height="8" tone="info" />
      <span class="value">{{ item.value }}{{ unit ?? "" }}</span>
    </li>
  </ul>
</template>

<style scoped>
.bars {
  display: grid;
  gap: var(--sp-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
li {
  display: grid;
  grid-template-columns: minmax(6em, max-content) 1fr max-content;
  gap: var(--sp-2);
  align-items: center;
  font-size: var(--fs-xs);
}
.value {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
</style>
