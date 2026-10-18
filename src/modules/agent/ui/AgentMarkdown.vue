<script setup lang="ts">
import { onBeforeUnmount, shallowRef, watch } from "vue";
import { createMarkdownStream } from "../lib/markdown-stream.ts";

/**
 * A markdown text that grows: closed blocks stay as they were, only the last one is redone. While
 * the text streams, a render that took long (a big open code block) is followed by a pause three
 * times as long, so rendering never takes more than a quarter of the main thread.
 */
const props = defineProps<{ text: string; streaming?: boolean }>();
const stream = createMarkdownStream();
const blocks = shallowRef(stream.update(props.text));
let timer: ReturnType<typeof setTimeout> | undefined;
let pausedUntil = 0;

function render() {
  clearTimeout(timer);
  timer = undefined;
  const started = performance.now();
  blocks.value = stream.update(props.text);
  const now = performance.now();
  pausedUntil = now + (now - started) * 3;
}
watch(
  () => [props.text, props.streaming] as const,
  ([, streaming]) => {
    const wait = pausedUntil - performance.now();
    if (!streaming || wait <= 0) render();
    else timer ??= setTimeout(render, wait);
  },
);
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <div class="md">
    <div v-for="block in blocks" :key="block.key" class="md-block" v-html="block.html" />
  </div>
</template>

<style scoped>
/* The blocks are only the unit of rendering: their content lays out as direct children of `.md`. */
.md-block {
  display: contents;
}
</style>
