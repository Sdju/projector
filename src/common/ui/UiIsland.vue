<script setup lang="ts">
import type { useIslandMenu } from "../utilities/island-menu.ts";

defineProps<{
  menu: ReturnType<typeof useIslandMenu>;
  label: string;
  width?: number;
  gap?: string;
}>();
</script>

<template>
  <Teleport to="body">
    <section
      v-if="menu.open.value"
      :id="menu.id"
      :ref="menu.island"
      class="island"
      role="dialog"
      :aria-label="label"
      :class="{ 'mobile-sheet': menu.compact.value }"
      :style="{
        ...menu.style.value,
        '--island-width': `${width ?? 340}px`,
        '--island-content-gap': gap ?? 'var(--sp-1)',
      }"
      @keydown="menu.keydown"
      @focusin="menu.trackFocus"
    >
      <slot />
    </section>
  </Teleport>
</template>

<style scoped>
.island {
  position: fixed;
  z-index: var(--z-popover);
  display: flex;
  flex-direction: column;
  gap: var(--island-content-gap);
  width: var(--island-width);
  max-width: calc(100vw - var(--sp-4));
  max-height: calc(100dvh - var(--island-top, 8px) - 8px);
  overflow-y: auto;
  padding: var(--sp-1);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-lg);
  background: var(--bg-2);
  box-shadow: var(--shadow-popover);
  font-size: var(--fs-xs);
}
</style>
