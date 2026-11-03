<script setup lang="ts">
defineProps<{ density?: "regular" | "compact"; align?: "center" | "start" }>();
</script>

<template>
  <p class="empty" :class="[density, align]"><slot /></p>
</template>

<style scoped>
.empty {
  margin: 0;
  padding: var(--sp-5) var(--sp-4);
  color: var(--muted);
  font-size: var(--fs-sm);
  text-align: center;
}
.compact {
  padding: var(--sp-2) var(--sp-3);
  font-size: var(--fs-xs);
}
.start {
  text-align: start;
}
</style>
