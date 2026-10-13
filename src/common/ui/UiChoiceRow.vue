<script setup lang="ts">
defineProps<{ title: string; description?: string }>();
</script>

<template>
  <label class="choice-row">
    <slot />
    <span
      ><strong>{{ title }}</strong
      ><small v-if="description">{{ description }}</small></span
    >
  </label>
</template>

<style scoped>
.choice-row {
  display: flex;
  gap: var(--sp-3);
  align-items: flex-start;
  padding: var(--ui-choice-space, var(--sp-3)) 0;
  cursor: pointer;
}
.choice-row :slotted(input) {
  margin-top: var(--sp-1);
}
strong {
  display: block;
  font-weight: 500;
}
small {
  display: block;
  color: var(--muted);
  font-size: var(--fs-xs);
  margin-top: var(--sp-1);
}
</style>
