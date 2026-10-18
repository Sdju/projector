<script setup lang="ts">
defineProps<{ gap?: number }>();
</script>

<template>
  <div class="row" :style="gap === undefined ? undefined : { gap: `${gap}px` }">
    <slot />
  </div>
</template>

<style scoped>
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--sp-5);
}
</style>
