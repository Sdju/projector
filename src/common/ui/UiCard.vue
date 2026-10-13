<script setup lang="ts">
/** A surface only: roles, focus, decisions and async state belong to the owner. */
defineProps<{
  as?: "section" | "div" | "article" | "li";
  appearance?: "card" | "frame";
  tone?: "neutral" | "warning";
  density?: "regular" | "compact" | "notice";
}>();
</script>

<template>
  <component
    :is="as ?? 'section'"
    :class="
      appearance === 'frame' ? 'ui-frame' : ['ui-card', tone ?? 'neutral', density ?? 'regular']
    "
  >
    <slot />
  </component>
</template>

<style scoped>
.ui-frame {
  padding: var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
}
.ui-card {
  display: grid;
  gap: var(--sp-2);
  padding: var(--sp-3);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-lg);
  background: var(--bg-2);
  font-size: var(--fs-2xs);
}
.neutral {
  color: var(--muted);
}
.compact {
  padding: var(--sp-2) var(--sp-3);
}
.notice {
  padding: 10px 12px;
}
.warning {
  border-color: color-mix(in srgb, var(--warn) 40%, var(--bg-2));
  background: color-mix(in srgb, var(--warn) 8%, var(--bg-2));
}
</style>
