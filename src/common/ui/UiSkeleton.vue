<script setup lang="ts">
/** Заглушка на месте ещё не загруженного содержимого: рисует только мерцающий блок. */
defineProps<{ width?: string; height?: string }>();
</script>

<template>
  <span
    class="ui-skeleton"
    :style="{ width: width ?? '100%', height: height ?? '12px' }"
    aria-hidden="true"
  />
</template>

<style scoped>
.ui-skeleton {
  display: block;
  border-radius: var(--r-sm);
  background: linear-gradient(90deg, var(--hover) 25%, var(--line) 50%, var(--hover) 75%) 0 0 / 300%
    100%;
  animation: ui-skeleton 1.4s ease-in-out infinite;
}
@keyframes ui-skeleton {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: 0 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ui-skeleton {
    animation: none;
  }
}
</style>
