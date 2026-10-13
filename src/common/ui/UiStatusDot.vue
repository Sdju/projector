<script setup lang="ts">
defineProps<{
  as?: "span" | "i";
  size?: 6 | 7 | 8;
  tone?: "success" | "danger" | "warning" | "muted" | "faint";
  inline?: boolean;
  shrink?: boolean;
  radius?: "full" | "circle";
}>();
</script>

<template>
  <component
    :is="as ?? 'span'"
    class="ui-status-dot"
    :class="[tone, { inline, fixed: !shrink, circle: radius === 'circle' }]"
    :style="{ '--ui-status-dot-size': `${size ?? 7}px` }"
  />
</template>

<style scoped>
.ui-status-dot {
  width: var(--ui-status-dot-size);
  height: var(--ui-status-dot-size);
  border-radius: var(--r-full);
}
.fixed {
  flex-shrink: 0;
}
.inline {
  display: inline-block;
}
.circle {
  border-radius: 50%;
}
.success {
  background: var(--run);
}
.danger {
  background: var(--err);
}
.warning {
  background: var(--warn);
}
.muted {
  background: var(--muted);
}
.faint {
  background: var(--faint);
}
</style>
