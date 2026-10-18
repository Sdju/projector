<script setup lang="ts">
defineProps<{ options: string[] }>();
const model = defineModel<string>({ required: true });
</script>

<template>
  <div class="tabs" role="tablist">
    <button
      v-for="option in options"
      :key="option"
      type="button"
      role="tab"
      :aria-selected="model === option"
      :class="{ on: model === option }"
      @click="model = option"
    >
      {{ option }}
    </button>
  </div>
</template>

<style scoped>
.tabs {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--r-md);
  background: var(--bg-3);
}
button {
  padding: 4px 12px;
  border: 0;
  border-radius: var(--r-sm);
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: var(--fs-xs);
  cursor: pointer;
}
.on {
  background: var(--bg-2);
  color: var(--text);
}
</style>
