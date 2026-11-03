<script setup lang="ts">
/** Native table styling. Data, columns, virtualization and scrolling belong to the caller. */
defineProps<{
  padding?: string;
  align?: "top" | "middle";
  sticky?: boolean;
  headerTone?: "muted";
  headerWeight?: 400 | 500;
  subtle?: boolean;
  hover?: boolean;
}>();
</script>

<template>
  <table
    class="ui-table"
    :class="{ sticky, hover }"
    :style="{
      '--ui-table-padding': padding ?? 'var(--sp-3) var(--sp-3)',
      '--ui-table-align': align,
      '--ui-table-header-color': headerTone === 'muted' ? 'var(--muted)' : undefined,
      '--ui-table-header-weight': headerWeight ?? 500,
      '--ui-table-body-border': subtle
        ? 'color-mix(in srgb, var(--line) 50%, transparent)'
        : 'var(--line)',
    }"
  >
    <slot />
  </table>
</template>

<style scoped>
.ui-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}
:where(.ui-table) :deep(> :is(thead, tbody, tfoot) > tr > :is(th, td)) {
  padding: var(--ui-table-padding);
  border-bottom: 1px solid var(--line);
  vertical-align: var(--ui-table-align, inherit);
}
:where(.ui-table) :deep(> tbody > tr > td) {
  border-bottom-color: var(--ui-table-body-border);
}
:where(.ui-table) :deep(> thead > tr > th) {
  color: var(--ui-table-header-color, inherit);
  font-weight: var(--ui-table-header-weight);
}
:where(.ui-table.sticky) :deep(> thead > tr > th) {
  position: sticky;
  top: 0;
  background: var(--bg-2);
}
:where(.ui-table.hover) :deep(> tbody > tr:hover > td) {
  background: var(--hover);
}
</style>
