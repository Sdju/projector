<script setup lang="ts">
import UiPopupSurface from "./UiPopupSurface.vue";
import type { ComponentPublicInstance } from "vue";
import type { useIslandMenu } from "../utilities/island-menu.ts";

const props = defineProps<{
  menu: ReturnType<typeof useIslandMenu>;
  label: string;
  width?: number;
  gap?: string;
  /** A hint, not a menu: the pointer passes through it, so it never ends the hover that opened it. */
  passive?: boolean;
}>();
function bindIsland(surface: Element | ComponentPublicInstance | null) {
  props.menu.island.value = (surface as InstanceType<typeof UiPopupSurface> | null)?.element;
}
</script>

<template>
  <Teleport to="body">
    <UiPopupSurface
      as="section"
      border="strong"
      radius="lg"
      flow="column"
      v-if="menu.open.value"
      :id="menu.id"
      :ref="bindIsland"
      class="island"
      role="dialog"
      :aria-label="label"
      :class="{ 'mobile-sheet': menu.compact.value, passive }"
      :style="{
        ...menu.style.value,
        '--island-width': `${width ?? 340}px`,
        '--island-content-gap': gap ?? 'var(--sp-1)',
      }"
      @keydown="menu.keydown"
      @focusin="menu.trackFocus"
    >
      <slot />
    </UiPopupSurface>
  </Teleport>
</template>

<style scoped>
.island {
  position: fixed;
  z-index: var(--z-popover);
  gap: var(--island-content-gap);
  width: var(--island-width);
  max-width: calc(100vw - var(--sp-4));
  max-height: calc(100dvh - var(--island-top, 8px) - 8px);
  overflow-y: auto;
  padding: var(--sp-1);
  font-size: var(--fs-xs);
}
.passive {
  pointer-events: none;
}
.mobile-sheet {
  --ui-island-chevron-transform: none;
  --ui-island-footer-display: none;
}
</style>
