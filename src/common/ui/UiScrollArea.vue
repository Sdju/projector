<script setup lang="ts">
import { shallowRef } from "vue";
/** The same native scroll owner; observers and virtualization use element directly. */
const element = shallowRef<HTMLDivElement>();
defineExpose({
  get element() {
    return element.value ?? undefined;
  },
});
</script>

<template>
  <div ref="element" class="ui-scroll-area"><slot /></div>
</template>

<style scoped>
.ui-scroll-area {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
</style>
