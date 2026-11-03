<script setup lang="ts">
/** The two existing form layouts; both stack at the established 700px viewport breakpoint. */
defineProps<{ layout?: "equal" | "wide-end" }>();
</script>

<template>
  <div class="form-grid" :class="layout ?? 'equal'"><slot /></div>
</template>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-3);
}
.wide-end {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr);
}
@media (max-width: 700px) {
  .form-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
