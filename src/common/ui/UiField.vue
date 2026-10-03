<script setup lang="ts">
defineProps<{
  label: string;
}>();
</script>

<template>
  <div class="field">
    <span>{{ label }}</span>
    <slot />
  </div>
</template>

<style scoped>
.field {
  display: grid;
  gap: 6px;
}

span {
  color: var(--muted);
  font-size: var(--fs-2xs);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
}
</style>
