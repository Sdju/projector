<script setup lang="ts">
import { onUpdated, ref, watch, type Component } from "vue";
import UiPanel from "../../../common/ui/UiPanel.vue";
import TabReadoutScope from "../../../common/ui/TabReadoutScope.vue";

const props = defineProps<{
  id: string;
  to?: HTMLElement | null;
  component: Component;
  viewProps?: Record<string, unknown>;
  scroll?: boolean;
  ownKeys?: boolean;
}>();
const panel = ref<HTMLElement | { element?: HTMLElement }>();
let positions: { element: HTMLElement; top: number; left: number }[] = [];
let restore = false;

function element() {
  return panel.value instanceof HTMLElement ? panel.value : panel.value?.element;
}
function capture() {
  const root = element();
  if (!root) return;
  positions = [root, ...root.querySelectorAll<HTMLElement>("*")]
    .filter((item) => item.scrollTop || item.scrollLeft)
    .map((item) => ({ element: item, top: item.scrollTop, left: item.scrollLeft }));
}
watch(
  () => props.to,
  (to) => {
    restore = !!to && positions.length > 0;
  },
  { flush: "pre" },
);
onUpdated(() => {
  if (!restore) return;
  restore = false;
  for (const position of positions) {
    position.element.scrollTop = position.top;
    position.element.scrollLeft = position.left;
  }
});
</script>

<template>
  <Teleport :to="to" :disabled="!to">
    <component
      :is="scroll ? 'div' : UiPanel"
      ref="panel"
      v-bind="scroll ? {} : { as: 'div', sizing: 'flex' }"
      :class="scroll ? 'kept-scroll' : 'kept-panel'"
      :data-own-keys="ownKeys || undefined"
      @scroll.capture="capture"
    >
      <TabReadoutScope :tab-key="id">
        <component :is="component" v-bind="viewProps" />
      </TabReadoutScope>
    </component>
  </Teleport>
</template>

<style scoped>
.kept-scroll {
  container-type: inline-size;
  height: 100%;
  overflow: auto;
  padding: var(--sp-4);
}
</style>
