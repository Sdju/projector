<script setup lang="ts">
/** Native button only: focus, selection and command policy belong to the menu owner. */
withDefaults(
  defineProps<{
    tone?: "neutral" | "muted" | "danger";
    type?: "button" | "submit" | "reset";
    separator?: "before" | "after";
    gap?: 1.5 | 2 | 3;
    fill?: boolean;
    /** Selection rows keep native focus and only paint the selected item. */
    interaction?: "menu" | "selection" | "item";
    padding?: string;
    justify?: "normal" | "between";
    radius?: "none" | "md";
  }>(),
  { fill: true },
);
</script>

<template>
  <button
    class="action-row"
    :class="[
      tone,
      separator,
      {
        tight: gap === 2,
        intrinsic: !fill,
        selection: interaction === 'selection',
        'item-interaction': interaction === 'item',
      },
    ]"
    :style="{
      '--action-row-padding': padding,
      '--action-row-gap': gap === 1.5 ? '6px' : undefined,
      justifyContent: justify === 'between' ? 'space-between' : undefined,
      borderRadius: radius === 'none' ? '0' : undefined,
    }"
    :type="type ?? 'button'"
  >
    <slot />
  </button>
</template>

<style scoped>
.action-row {
  display: flex;
  align-items: center;
  gap: var(--action-row-gap, var(--sp-3));
  width: 100%;
  padding: var(--action-row-padding, 6px var(--sp-2));
  border-radius: var(--r-md);
  text-align: left;
}
.action-row:where(:not(.selection, .item-interaction)):hover:not(:disabled),
.action-row:where(:not(.selection, .item-interaction)):focus-visible {
  background: var(--active);
  outline: none;
}
.action-row:where(:not(.selection, .item-interaction)):disabled {
  opacity: 0.45;
}
.action-row.selection.selected {
  background: var(--hover);
}
.danger {
  color: var(--err);
}
.neutral {
  color: var(--text);
}
.muted {
  color: var(--muted);
}
.action-row.item-interaction:hover {
  background: var(--hover);
  color: var(--text);
}
.action-row.item-interaction.selected {
  background: var(--active);
  color: var(--text);
}
.tight {
  gap: var(--sp-2);
}
.intrinsic {
  width: auto;
}
.before {
  border-top: 1px solid var(--line);
  margin-top: var(--sp-1);
  border-radius: 0 0 var(--r-md) var(--r-md);
}
.after {
  border-bottom: 1px solid var(--line);
  margin-bottom: var(--sp-1);
  border-radius: var(--r-md) var(--r-md) 0 0;
}
</style>
