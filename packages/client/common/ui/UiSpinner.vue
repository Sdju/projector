<script setup lang="ts">
import IconLoader from "~icons/lucide/loader-circle";
/** Independent rotation preserves an owner's positioning transform. */
defineProps<{ label?: string; independent?: boolean }>();
</script>

<template>
  <IconLoader
    class="ui-spinner"
    :class="{ independent }"
    :aria-hidden="label ? undefined : true"
    :aria-label="label"
  />
</template>

<style scoped>
.ui-spinner {
  animation: ui-spin 1s linear infinite;
}
.independent {
  animation-name: ui-rotate;
}
@keyframes ui-spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes ui-rotate {
  to {
    rotate: 360deg;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ui-spinner {
    animation: none;
  }
}
</style>
