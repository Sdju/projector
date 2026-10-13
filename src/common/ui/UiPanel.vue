<script setup lang="ts">
import { shallowRef } from "vue";
/** Full-height or flex column; children own their viewport and scroll behavior. */
defineProps<{ as?: "section" | "div" | "article" | "form"; sizing?: "height" | "flex" }>();
const element = shallowRef<HTMLElement>();
defineExpose({
  get element() {
    return element.value ?? undefined;
  },
});
</script>

<template>
  <component
    :is="as ?? 'section'"
    ref="element"
    class="ui-panel"
    :class="{ flex: sizing === 'flex' }"
    ><slot
  /></component>
</template>

<style scoped>
.ui-panel {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.ui-panel.flex {
  height: auto;
  flex: 1;
  min-width: 0;
}
</style>
