<script setup lang="ts">
import { onErrorCaptured, shallowRef, watch, type Component } from "vue";
import { compileWidget } from "../lib/widget-compile.ts";
import { widgetComponents } from "./widgets/index.ts";

const props = defineProps<{ source: string; complete: boolean }>();
const body = shallowRef<Component>();
const failure = shallowRef("");
let generation = 0;

// An unfinished source is never compiled: it waits as a placeholder until its closing tag arrives,
// then compiles once. A finished source does not change, so this watcher fires once per widget.
watch(
  () => (props.complete ? props.source : ""),
  async (source) => {
    if (!source) return;
    // The old body goes with its error: left mounted it would fail again on the next render and
    // keep the failure up, although the next source (for example a script that arrived later) is fine.
    body.value = undefined;
    failure.value = "";
    const current = ++generation;
    try {
      const compiled = await compileWidget(source, widgetComponents);
      if (current === generation) body.value = compiled;
    } catch (error) {
      if (current === generation)
        failure.value = error instanceof Error ? error.message : String(error);
    }
  },
  { immediate: true },
);
onErrorCaptured((error) => {
  failure.value = error instanceof Error ? error.message : String(error);
  return false;
});
</script>

<template>
  <div class="widget">
    <div v-if="failure" class="widget-failure" role="alert">
      <p>{{ failure }}</p>
      <pre>{{ source }}</pre>
    </div>
    <component :is="body" v-else-if="body" />
    <div v-else class="widget-pending" aria-busy="true" />
  </div>
</template>

<style scoped>
.widget {
  margin: 12px 0;
}
.widget-pending {
  height: 56px;
  border: 1px dashed var(--line);
  border-radius: var(--r-md);
}
.widget-failure {
  color: var(--err);
  font-size: var(--fs-xs);
}
.widget-failure pre {
  color: var(--muted);
  overflow-x: auto;
}
</style>
