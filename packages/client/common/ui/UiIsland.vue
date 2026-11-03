<script setup lang="ts">
import UiPopupSurface from "./UiPopupSurface.vue";
import { computed, type ComponentPublicInstance } from "vue";
import { useSheetDismiss } from "../utilities/sheet-dismiss.ts";
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
const sheet = useSheetDismiss({
  element: props.menu.island,
  enabled: computed(() => props.menu.compact.value && !props.passive),
  close: () => props.menu.close(),
});
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
      :class="{
        'mobile-sheet': menu.compact.value,
        'sheet-dragging': sheet.dragging.value,
        passive,
      }"
      :style="{
        ...menu.style.value,
        '--island-width': `${width ?? 340}px`,
        '--island-content-gap': gap ?? 'var(--sp-1)',
      }"
      @keydown="menu.keydown"
      @focusin="menu.trackFocus"
    >
      <span v-if="menu.compact.value && !passive" class="sheet-grabber" aria-hidden="true" />
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
.sheet-grabber {
  flex: none;
  align-self: center;
  width: 36px;
  height: 4px;
  margin: 2px 0 4px;
  border-radius: var(--r-full);
  background: var(--line-strong);
  opacity: 0.9;
}
.sheet-dragging .sheet-grabber {
  background: var(--muted);
}
</style>
