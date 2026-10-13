<script setup lang="ts">
defineProps<{ variant?: "padded" | "plain"; hideOnCompact?: boolean }>();
</script>

<template>
  <footer class="island-footer" :class="[variant ?? 'padded', { 'hide-compact': hideOnCompact }]">
    <slot />
  </footer>
</template>

<style scoped>
.island-footer {
  color: var(--faint);
  font-size: var(--fs-2xs);
}
.padded {
  padding: var(--sp-1) var(--sp-2) 2px;
}
.plain {
  padding: 0 var(--sp-2);
}
.hide-compact {
  display: var(--ui-island-footer-display, block);
}
</style>
