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
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
</style>
