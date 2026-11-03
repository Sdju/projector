<script setup lang="ts">
import IconChevron from "~icons/lucide/chevron-down";
defineProps<{ anchor?: "start" | "end"; chevron?: boolean }>();
</script>

<template>
  <button type="button" class="island-header" :class="anchor ?? 'end'">
    <slot />
    <IconChevron v-if="chevron" class="island-chevron" aria-hidden="true" />
  </button>
</template>

<style scoped>
.island-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--control-h-sm);
  padding-inline: var(--sp-2) 7px;
  border-radius: var(--r-md);
  color: var(--text);
}
.start {
  justify-content: normal;
  gap: var(--sp-2);
  padding-inline: 7px var(--sp-2);
}
.island-header :slotted(svg),
.island-chevron {
  width: 14px;
  height: 14px;
}
.island-chevron {
  flex-shrink: 0;
  transform: var(--ui-island-chevron-transform, rotate(180deg));
}
</style>
