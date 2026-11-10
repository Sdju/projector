<script setup lang="ts">
import UiSpinner from "./UiSpinner.vue";

/**
 * One async-state marker: spinner, text and a live region. Owners still decide when to show it and
 * what the error/empty states look like.
 */
withDefaults(
  defineProps<{
    label?: string;
    size?: "sm" | "md";
    align?: "start" | "center";
    tone?: "muted" | "danger";
    padding?: 0 | 1 | 2 | 3 | 4;
  }>(),
  { label: "Загрузка…", size: "md", align: "start", tone: "muted" },
);
</script>

<template>
  <span
    class="ui-loader"
    :class="[size, align, tone]"
    :style="padding === undefined ? undefined : { padding: `var(--sp-${padding})` }"
    role="status"
    aria-live="polite"
  >
    <UiSpinner class="spinner" />
    <span class="label"
      ><slot>{{ label }}</slot></span
    >
  </span>
</template>

<style scoped>
.ui-loader {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
  color: var(--muted);
  font-size: var(--fs-xs);
  line-height: 1.35;
}
.ui-loader.center {
  width: 100%;
  justify-content: center;
}
.ui-loader.sm {
  gap: 6px;
  font-size: var(--fs-2xs);
}
.ui-loader.danger {
  color: var(--err);
}
.spinner {
  flex: none;
  width: 1.1em;
  height: 1.1em;
}
.label {
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
