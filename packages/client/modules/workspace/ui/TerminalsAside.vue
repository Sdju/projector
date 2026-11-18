<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref } from "vue";
import { asideTargetKey } from "../lib/aside-target.ts";

/** Right-rail section «Терминалы»: the dock teleports the terminal group into this element. */
const target = ref<HTMLElement>();
const shared = inject(asideTargetKey, undefined);
onMounted(() => {
  if (shared) shared.value = target.value;
});
onBeforeUnmount(() => {
  if (shared && shared.value === target.value) shared.value = undefined;
});
</script>

<template>
  <div id="workspace-aside-terminals" ref="target" class="terminals-host" />
</template>

<style scoped>
.terminals-host {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
</style>
