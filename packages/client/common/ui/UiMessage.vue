<script setup lang="ts">
/** Rendering only: announcement role and async lifecycle belong to the owner. */
defineProps<{
  as?: "p" | "div" | "span";
  tone?: "danger" | "muted";
  variant?: "plain" | "note" | "padded";
  size?: "2xs" | "xs" | "sm";
  padding?: 3 | 4;
  flush?: boolean;
  wrap?: boolean;
}>();
</script>

<template>
  <component
    :is="as ?? 'p'"
    class="message"
    :style="padding === undefined ? undefined : { '--ui-message-padding': `var(--sp-${padding})` }"
    :class="[tone, variant, size ? `size-${size}` : undefined, { flush, wrap }]"
    ><slot
  /></component>
</template>

<style scoped>
.danger {
  color: var(--err);
}
.muted {
  color: var(--muted);
}
.note {
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
  font-size: var(--fs-xs);
}
.padded {
  padding: var(--ui-message-padding, var(--sp-3));
}
.size-2xs {
  font-size: var(--fs-2xs);
}
.size-xs {
  font-size: var(--fs-xs);
}
.size-sm {
  font-size: var(--fs-sm);
}
.flush {
  margin: 0;
}
.wrap {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
