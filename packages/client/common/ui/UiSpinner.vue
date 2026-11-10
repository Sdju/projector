<script setup lang="ts">
import IconLoader from "~icons/lucide/loader-circle";
defineProps<{ label?: string }>();
</script>

<template>
  <IconLoader class="ui-spinner" :aria-hidden="label ? undefined : true" :aria-label="label" />
</template>

<style scoped>
/* Rotation keeps the SVG's default centre origin; owners centre it without transforms. */
.ui-spinner {
  animation: ui-spin 1s linear infinite;
}
@keyframes ui-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .ui-spinner {
    animation: none;
  }
}
</style>
