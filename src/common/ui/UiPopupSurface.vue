<script setup lang="ts">
import { shallowRef } from "vue";
/** Rendering only: placement, visibility, scrolling, role and input policy belong to the owner. */
defineProps<{
  as?: "div" | "section";
  border?: "line" | "strong";
  radius?: "md" | "lg";
  flow?: "column";
  surface?: "secondary" | "tertiary";
}>();
const element = shallowRef<HTMLElement>();
defineExpose({
  get element() {
    return element.value ?? undefined;
  },
});
</script>

<template>
  <component
    :is="as ?? 'div'"
    ref="element"
    class="popup-surface"
    :class="{ column: flow === 'column' }"
    :style="{
      '--popup-border': border === 'line' ? 'var(--line)' : 'var(--line-strong)',
      '--popup-background': surface === 'tertiary' ? 'var(--bg-3)' : 'var(--bg-2)',
      '--popup-radius': radius === 'md' ? 'var(--r-md)' : 'var(--r-lg)',
    }"
    ><slot
  /></component>
</template>

<style scoped>
.popup-surface {
  border: 1px solid var(--popup-border);
  border-radius: var(--popup-radius);
  background: var(--popup-background);
  box-shadow: var(--shadow-popover);
}
.column {
  display: flex;
  flex-direction: column;
}
</style>
