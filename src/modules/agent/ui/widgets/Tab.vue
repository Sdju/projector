<script setup lang="ts">
import { computed, inject, onBeforeUnmount } from "vue";
import { tabsKey } from "./tabs.ts";

const props = defineProps<{ title: string; hint?: string }>();
const tabs = inject(tabsKey, null);
// Registered in render order, so the header follows the order the panels are written in.
if (tabs) onBeforeUnmount(tabs.register(props.title, props.hint));
const shown = computed(() => !tabs || tabs.active.value === props.title);
</script>

<template>
  <!-- v-show, not v-if: a hidden panel keeps its state (typed text, chosen options). -->
  <div v-show="shown" class="panel" role="tabpanel">
    <slot />
  </div>
</template>

<style scoped>
.panel {
  display: grid;
  gap: var(--sp-3);
  padding-top: var(--sp-3);
}
</style>
