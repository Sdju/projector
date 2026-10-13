<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: "inline" | "padded" | "fit";
    highlight?: boolean;
  }>(),
  { variant: "inline", highlight: true },
);
</script>

<template>
  <summary class="ui-disclosure-summary" :class="[`variant-${variant}`, { highlight }]">
    <slot />
  </summary>
</template>

<style scoped>
.ui-disclosure-summary {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  cursor: pointer;
  list-style: none;
}
.ui-disclosure-summary::-webkit-details-marker {
  display: none;
}
.highlight:hover {
  color: var(--text);
}
.variant-padded {
  padding: var(--sp-1) 0;
  min-width: 0;
}
.variant-fit {
  max-width: 100%;
  width: fit-content;
  gap: 7px;
  padding: 5px 0;
}
.variant-padded:focus-visible,
.variant-fit:focus-visible {
  outline-offset: 3px;
  border-radius: var(--r-md);
}
</style>
