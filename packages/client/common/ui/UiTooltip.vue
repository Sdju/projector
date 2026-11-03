<script setup lang="ts">
import UiPopupSurface from "./UiPopupSurface.vue";
import { computed, onBeforeUnmount, useId, useTemplateRef } from "vue";

/**
 * Hover and focus hint for the element in the default slot. The text lives in the `content` slot
 * and is linked to the trigger through the `describedby` slot prop. The bubble is a popover
 * (top layer, so no clipping or z-index) placed by CSS anchor positioning: above the trigger, and
 * flipped by the browser where there is no room.
 */
const props = defineProps<{ delay?: number }>();

const id = useId();
const anchor = computed(() => `--tooltip-${id.replace(/\W/g, "")}`);
const surface = useTemplateRef("surface");
let timer: ReturnType<typeof setTimeout> | undefined;

function show(delay: number) {
  clearTimeout(timer);
  timer = setTimeout(() => surface.value?.element?.showPopover(), delay);
}
function hide() {
  clearTimeout(timer);
  const element = surface.value?.element;
  if (element?.matches(":popover-open")) element.hidePopover();
}
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <span
    class="tooltip-anchor"
    :style="{ anchorName: anchor }"
    @mouseenter="show(props.delay ?? 200)"
    @focusin="show(0)"
    @mouseleave="hide"
    @focusout="hide"
    @mousedown="hide"
    @keydown.esc="hide"
  >
    <slot :describedby="id" />
    <UiPopupSurface
      :id="id"
      ref="surface"
      popover="manual"
      class="tooltip"
      border="strong"
      radius="md"
      surface="tertiary"
      role="tooltip"
      :style="{ positionAnchor: anchor }"
    >
      <slot name="content" />
    </UiPopupSurface>
  </span>
</template>

<style scoped>
.tooltip-anchor {
  display: inline-flex;
}
.tooltip {
  inset: auto;
  margin: var(--sp-1) 0;
  width: max-content;
  max-width: min(340px, calc(100vw - 2 * var(--sp-2)));
  padding: var(--sp-2) var(--sp-3);
  color: var(--text);
  font-size: var(--fs-xs);
  line-height: var(--lh);
  overflow: visible;
  pointer-events: none;
  position-area: top span-right;
  position-try-fallbacks:
    flip-block,
    flip-inline,
    flip-block flip-inline;
}
</style>
