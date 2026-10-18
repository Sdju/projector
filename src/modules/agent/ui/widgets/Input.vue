<script setup lang="ts">
defineProps<{ label?: string; placeholder?: string; multiline?: boolean }>();
const model = defineModel<string>({ required: true });
</script>

<template>
  <label class="field">
    <span v-if="label">{{ label }}</span>
    <textarea v-if="multiline" v-model="model" rows="3" :placeholder="placeholder" />
    <input v-else v-model="model" type="text" :placeholder="placeholder" />
  </label>
</template>

<style scoped>
.field {
  display: grid;
  gap: 4px;
  font-size: var(--fs-xs);
}
input,
textarea {
  padding: 6px 8px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  background: var(--bg-3);
  color: var(--text);
  font: inherit;
  resize: vertical;
}
</style>
