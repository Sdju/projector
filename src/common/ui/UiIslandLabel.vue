<script setup lang="ts">
defineProps<{ divided?: boolean }>();
</script>

<template>
  <div class="island-label" :class="{ divided }"><slot /></div>
</template>

<style scoped>
.island-label {
  padding: var(--sp-2) var(--sp-2) var(--sp-1);
  color: var(--faint);
  font-size: var(--fs-2xs);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
}
.divided {
  margin-top: var(--sp-1);
  padding-bottom: 2px;
  border-top: 1px solid var(--line);
}
</style>
