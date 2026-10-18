<script setup lang="ts">
defineProps<{ label?: string; min?: number; max?: number; step?: number; unit?: string }>();
const model = defineModel<number>({ required: true });
</script>

<template>
  <label class="slider">
    <span class="head"
      ><span>{{ label }}</span
      ><output>{{ model }}{{ unit ?? "" }}</output></span
    >
    <input
      v-model.number="model"
      type="range"
      :min="min ?? 0"
      :max="max ?? 100"
      :step="step ?? 1"
    />
  </label>
</template>

<style scoped>
.slider {
  display: grid;
  gap: 4px;
  font-size: var(--fs-xs);
}
.head {
  display: flex;
  justify-content: space-between;
}
output {
  font-variant-numeric: tabular-nums;
  color: var(--text-2);
}
input {
  width: 100%;
  accent-color: var(--info);
}
</style>
