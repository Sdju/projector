<script setup lang="ts" generic="T">
import { computed, ref, watch, type ComponentPublicInstance } from "vue";
import { useEventListener } from "@vueuse/core";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/vue-virtual";

// Renderless: the consumer owns the scroll container and semantic row markup.
const props = withDefaults(
  defineProps<{
    items: readonly T[];
    itemKey: (item: T) => string | number;
    scrollElement: HTMLElement | null;
    estimateSize?: number | ((item: T, index: number) => number);
    overscan?: number;
    scrollMargin?: number;
    resetKey?: unknown;
  }>(),
  { estimateSize: 64, overscan: 6, scrollMargin: 0 },
);

const focusedKey = ref<string | number>();
const virtualizer = useVirtualizer(
  computed(() => {
    const retainedKey = focusedKey.value;
    const retainedIndex =
      retainedKey === undefined
        ? -1
        : props.items.findIndex((item) => props.itemKey(item) === retainedKey);
    return {
      count: props.items.length,
      getScrollElement: () => props.scrollElement,
      getItemKey: (index: number) => props.itemKey(props.items[index]!),
      estimateSize: (index: number) =>
        typeof props.estimateSize === "function"
          ? props.estimateSize(props.items[index]!, index)
          : props.estimateSize,
      overscan: props.overscan,
      useAnimationFrameWithResizeObserver: true,
      scrollMargin: props.scrollMargin,
      rangeExtractor: (range: Parameters<typeof defaultRangeExtractor>[0]) => {
        const visible = defaultRangeExtractor(range);
        return retainedIndex < 0 || visible.includes(retainedIndex)
          ? visible
          : [...visible, retainedIndex].sort((a, b) => a - b);
      },
    };
  }),
);

function updateFocus() {
  const active = props.scrollElement?.contains(document.activeElement)
    ? document.activeElement?.closest<HTMLElement>("[data-virtual-index]")
    : null;
  const item = active ? props.items[Number(active.dataset.virtualIndex)] : undefined;
  focusedKey.value = item === undefined ? undefined : props.itemKey(item);
}
useEventListener(() => props.scrollElement, "focusin", updateFocus);
useEventListener(
  () => props.scrollElement,
  "focusout",
  () => queueMicrotask(updateFocus),
);

const layout = computed(() => {
  let end = props.scrollMargin;
  const rows = virtualizer.value.getVirtualItems().map((row) => {
    const gapBefore = Math.max(0, row.start - end);
    end = row.end;
    const item = props.items[row.index]!;
    return { item, index: row.index, key: props.itemKey(item), gapBefore };
  });
  return {
    rows,
    paddingAfter: Math.max(0, virtualizer.value.getTotalSize() + props.scrollMargin - end),
  };
});

function measureElement(element: Element | ComponentPublicInstance | null) {
  if (element === null || element instanceof HTMLElement) virtualizer.value.measureElement(element);
}
watch(
  () => props.resetKey,
  () => {
    virtualizer.value.scrollToOffset(0);
  },
  { flush: "post" },
);
watch(
  () => props.items.length,
  () => {
    const element = props.scrollElement;
    if (element)
      element.scrollTop = Math.min(
        element.scrollTop,
        Math.max(0, virtualizer.value.getTotalSize() + props.scrollMargin - element.clientHeight),
      );
  },
  { flush: "post" },
);

defineExpose({
  scrollToIndex: (index: number) => virtualizer.value.scrollToIndex(index, { align: "auto" }),
  measure: () => virtualizer.value.measure(),
});
</script>

<template>
  <slot
    :rows="layout.rows"
    :padding-after="layout.paddingAfter"
    :measure-element="measureElement"
  />
</template>
