<script setup lang="ts">
defineProps<{
  as?: "div" | "form" | "header" | "footer";
  gap?: 1 | 2 | 3 | 4 | 5 | 6;
  columnGap?: 1 | 2 | 3 | 4 | 5 | 6;
  text?: "xs";
  justify?: "between";
  wrap?: boolean;
}>();
</script>

<template>
  <component
    :is="as ?? 'div'"
    class="ui-toolbar"
    :style="{
      '--toolbar-row-gap': `var(--sp-${gap ?? 2})`,
      '--toolbar-column-gap': `var(--sp-${columnGap ?? gap ?? 2})`,
      fontSize: text === 'xs' ? 'var(--fs-xs)' : undefined,
      justifyContent: justify === 'between' ? 'space-between' : undefined,
      flexWrap: wrap ? 'wrap' : undefined,
    }"
    ><slot
  /></component>
</template>

<style scoped>
.ui-toolbar {
  display: flex;
  align-items: center;
  row-gap: var(--toolbar-row-gap);
  column-gap: var(--toolbar-column-gap);
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--line);
}
</style>
