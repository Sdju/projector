<script setup lang="ts">
/** A native separator only; resizing, units, value and keyboard policy belong to its owner. */
defineProps<{
  orientation?: "horizontal" | "vertical";
  appearance?: "gap" | "bar" | "line";
  dragging?: boolean;
  labelled?: boolean;
}>();
</script>

<template>
  <div
    class="ui-resize-handle"
    :class="[orientation ?? 'horizontal', appearance ?? 'bar', { dragging, labelled }]"
    role="separator"
    :aria-orientation="orientation ?? 'horizontal'"
    tabindex="0"
  >
    <slot />
  </div>
</template>

<style scoped>
.ui-resize-handle {
  touch-action: none;
}
.horizontal {
  cursor: row-resize;
}
.vertical {
  cursor: col-resize;
}
.gap {
  position: relative;
  z-index: 1;
  flex: none;
}
.gap.vertical {
  width: var(--island-gap);
}
.gap.horizontal {
  height: var(--island-gap);
}
.gap::before {
  content: "";
  position: absolute;
  border-radius: var(--r-full);
  transition: background var(--t-fast);
}
.gap.vertical::before {
  inset: 0 calc(var(--island-gap) / 2 - 1px);
}
.gap.horizontal::before {
  inset: calc(var(--island-gap) / 2 - 1px) 0;
}
.gap:hover::before,
.gap:active::before {
  background: var(--line-strong);
}
.gap:focus-visible,
.line:focus-visible {
  outline: none;
}
.gap:focus-visible::before {
  background: var(--focus);
}
.bar {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 12px;
  user-select: none;
  background: var(--bg-3);
  border-block: 1px solid var(--line);
}
.bar::before {
  content: "";
  width: 36px;
  height: 2px;
  border-radius: var(--r-sm);
  background: var(--faint);
}
.bar.labelled::before {
  display: none;
}
.bar:hover,
.bar:focus-visible {
  background: var(--bg-4);
  outline-offset: -2px;
}
.line {
  flex: none;
  position: relative;
  height: 9px;
  margin-block: -4px;
  z-index: 2;
  user-select: none;
}
.line::before {
  content: "";
  position: absolute;
  inset: 4px 0;
  background: var(--line);
}
.line:hover::before,
.line:focus-visible::before,
.line.dragging::before {
  inset: 3px 0;
  background: var(--faint);
}

.bar.vertical {
  height: auto;
  width: 12px;
  border-block: 0;
  border-inline: 1px solid var(--line);
}
.bar.vertical::before {
  width: 2px;
  height: 36px;
}
.line.vertical {
  height: auto;
  width: 9px;
  margin-block: 0;
  margin-inline: -4px;
}
.line.vertical::before {
  inset: 0 4px;
}
.line.vertical:hover::before,
.line.vertical:focus-visible::before,
.line.vertical.dragging::before {
  inset: 0 3px;
}
</style>
