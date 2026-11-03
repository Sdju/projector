<script setup lang="ts">
defineProps<{
  as?: "div" | "header" | "footer" | "p" | "label" | "li" | "span" | "a" | "button";
  gap?: "none" | 0.5 | 0.75 | 1 | 1.25 | 1.5 | 2 | 3 | 4 | 5 | 6;
  inline?: boolean;
  align?:
    | "center"
    | "start"
    | "end"
    | "baseline"
    | "stretch"
    | "normal"
    | "flex-start"
    | "flex-end";
  justify?: "start" | "end" | "center" | "between" | "normal" | "flex-start" | "flex-end";
  wrap?: boolean;
}>();
</script>

<template>
  <component
    :is="as ?? 'div'"
    class="ui-inline"
    :class="{ inline }"
    :style="{
      '--inline-gap':
        gap === 'none'
          ? 'normal'
          : gap && !Number.isInteger(gap)
            ? `${gap * 4}px`
            : `var(--sp-${gap ?? 2})`,
      alignItems: align ?? 'center',
      justifyContent: justify === 'between' ? 'space-between' : (justify ?? 'start'),
      flexWrap: wrap ? 'wrap' : 'nowrap',
    }"
  >
    <slot />
  </component>
</template>

<style scoped>
.ui-inline {
  display: flex;
  gap: var(--inline-gap);
}
.ui-inline.inline {
  display: inline-flex;
}
</style>
