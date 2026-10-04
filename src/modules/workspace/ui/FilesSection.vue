<script setup lang="ts">
import { ref, useAttrs } from "vue";
import { FileTree } from "../modules/tree/index.ts";

/** Sidebar section «Файлы»: the tree in the section frame; props and listeners go to the tree. */
defineOptions({ inheritAttrs: false });
const tree = ref<InstanceType<typeof FileTree>>();
const attrs = useAttrs() as unknown as InstanceType<typeof FileTree>["$props"];
defineExpose({ reveal: (path: string) => tree.value?.reveal(path) });
</script>

<template>
  <div class="side-content">
    <FileTree ref="tree" v-bind="attrs" />
  </div>
</template>
