<script setup lang="ts">
defineProps<{
  tone?: "neutral" | "info" | "warning" | "danger";
  mono?: boolean;
  /** Context-menu hints previously participated in flex shrinking. */
  shrink?: boolean;
}>();
</script>

<template>
  <span
    class="ui-badge"
    :class="[tone ?? 'neutral', { mono }]"
    :style="{ flexShrink: shrink ? 1 : 0 }"
  >
    <slot />
  </span>
</template>

<style scoped>
.ui-badge {
  padding: 1px 6px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.mono {
  font: var(--fs-2xs) var(--mono);
  font-variant-numeric: tabular-nums;
}
.info {
  color: var(--info);
  border-color: color-mix(in srgb, var(--info) 55%, var(--line));
}
.warning {
  color: var(--warn);
  border-color: color-mix(in srgb, var(--warn) 55%, var(--line));
}
.danger {
  color: var(--err);
  border-color: color-mix(in srgb, var(--err) 55%, var(--line));
}
</style>
