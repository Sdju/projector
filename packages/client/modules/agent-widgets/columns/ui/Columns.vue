<script setup lang="ts">
defineProps<{ cols?: number; gap?: number }>();
</script>

<template>
  <div class="columns">
    <div
      class="grid"
      :style="{
        '--cols': cols ?? 2,
        ...(gap === undefined ? {} : { gap: `${gap}px` }),
      }"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
/* The chat column is narrow: below 30em wide the columns stack instead of squeezing. */
.columns {
  container-type: inline-size;
}
.grid {
  display: grid;
  grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
  /* A row of cards shares a height; inner charts keep their own size. */
  align-items: stretch;
  gap: var(--sp-4);
}
@container (max-width: 30em) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
