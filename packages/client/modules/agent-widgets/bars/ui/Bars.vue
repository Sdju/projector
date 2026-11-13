<script setup lang="ts">
import UiMeter from "../../../../common/ui/UiMeter.vue";
import { computed } from "vue";

const props = defineProps<{ items: { label: string; value: number }[]; unit?: string }>();
const max = computed(() => Math.max(1, ...props.items.map((item) => item.value)));
</script>

<template>
  <ul class="bars">
    <li v-for="item in items" :key="item.label">
      <span class="head">
        <span class="label">{{ item.label }}</span>
        <span class="value">{{ item.value }}{{ unit ?? "" }}</span>
      </span>
      <UiMeter :value="Math.min(100, (item.value / max) * 100)" :height="5" tone="info" soft />
    </li>
  </ul>
</template>

<style scoped>
.bars {
  display: grid;
  gap: var(--sp-2);
  margin: 0;
  padding: 0;
  min-width: 0;
  list-style: none;
}
li {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-3);
  font-size: var(--fs-2xs);
}
.label {
  overflow: hidden;
  color: var(--muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.value {
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
</style>
