<script setup lang="ts">
import { inject, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { createMarkdownStream } from "../lib/markdown-stream.ts";
import { renderChatMarkdown } from "../lib/markdown.ts";
import { chatImageSource } from "../lib/markdown-images.ts";
import { chatProjectKey } from "./chat-project.ts";
import AgentImageModal from "./AgentImageModal.vue";

/**
 * A markdown text that grows: closed blocks stay as they were, only the last one is redone. While
 * the text streams, a render that took long (a big open code block) is followed by a pause three
 * times as long, so rendering never takes more than a quarter of the main thread.
 */
const props = defineProps<{ text: string; streaming?: boolean }>();
const projectId = inject(chatProjectKey, "");
const stream = createMarkdownStream((markdown) =>
  renderChatMarkdown(markdown, { resolveImage: (src) => chatImageSource(src, projectId) }),
);
const blocks = shallowRef(stream.update(props.text));
const preview = ref<{ src: string; alt: string }>();
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

/** A click on a picture opens the modal viewer; a picture inside a link keeps the link's job. */
function openImage(event: MouseEvent) {
  if (!(event.target instanceof Element)) return;
  const image = event.target.closest(".md img");
  if (!(image instanceof HTMLImageElement) || image.closest("a")) return;
  const src = image.currentSrc || image.src;
  if (!src) return;
  event.preventDefault();
  preview.value = { src, alt: image.alt };
}
// A source that failed to load leaves a link with its alt text instead of a broken icon.
function replaceBrokenImage(event: Event) {
  if (!(event.target instanceof HTMLImageElement)) return;
  const image = event.target;
  const src = image.currentSrc || image.src;
  const link = document.createElement("a");
  link.className = "md-image-text";
  link.textContent = image.alt || "Изображение";
  if (src) link.href = src;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  image.replaceWith(link);
}
</script>

<template>
  <div class="md" @click="openImage" @error.capture="replaceBrokenImage">
    <div v-for="block in blocks" :key="block.key" class="md-block" v-html="block.html" />
  </div>
  <AgentImageModal
    v-if="preview"
    :src="preview.src"
    :alt="preview.alt"
    @close="preview = undefined"
  />
</template>

<style scoped>
/* The blocks are only the unit of rendering: their content lays out as direct children of `.md`. */
.md-block {
  display: contents;
}
</style>
