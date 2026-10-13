<script setup lang="ts">
defineProps<{
  as?: "div" | "section" | "fieldset" | "form" | "ul";
  gap?: "none" | 1 | 2 | 3 | 4 | 5 | 6;
  flow?: "grid" | "flex";
  align?: "start" | "center" | "end" | "stretch";
}>();
</script>

<template>
  <component
    :is="as ?? 'div'"
    class="ui-stack"
    :class="{ flex: flow === 'flex' }"
    :style="{
      '--stack-gap': gap === 'none' ? 'normal' : `var(--sp-${gap ?? 3})`,
      justifyItems: flow === 'flex' ? undefined : align,
      alignItems: flow === 'flex' ? align : undefined,
    }"
  >
    <slot />
  </component>
</template>

<style scoped>
.ui-stack {
  display: grid;
  gap: var(--stack-gap);
  min-width: 0;
}
.flex {
  display: flex;
  flex-direction: column;
}
fieldset.ui-stack {
  margin: 0;
  padding: 0;
  border: 0;
}
</style>
