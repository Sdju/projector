<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import ImageModal from "../../../common/ui/ImageModal.vue";
import { renderSafeMarkdown } from "../lib/markdown.ts";
import { createMermaidBlock, type MermaidBlock } from "../lib/mermaid.ts";
import MermaidModal from "./MermaidModal.vue";
import "./markdown.css";

const props = defineProps<{
  text: string;
  resolveImage?: (src: string) => string | undefined;
}>();
const root = ref<HTMLElement>();
const preview = ref<{ src: string; alt: string }>();
const mermaidPreview = ref<string>();
const diagrams = new Set<MermaidBlock>();
const html = computed(() =>
  renderSafeMarkdown(props.text, { resolveImage: props.resolveImage, breaks: false }),
);

function destroyDiagrams() {
  for (const diagram of diagrams) diagram.destroy();
  diagrams.clear();
}

watch(
  html,
  async () => {
    destroyDiagrams();
    await nextTick();
    for (const placeholder of root.value?.querySelectorAll<HTMLElement>(".md-mermaid") ?? []) {
      const source = placeholder.textContent ?? "";
      const diagram = createMermaidBlock(source, { expand: () => (mermaidPreview.value = source) });
      diagrams.add(diagram);
      placeholder.replaceWith(diagram.element);
    }
  },
  { flush: "post", immediate: true },
);
onBeforeUnmount(destroyDiagrams);

function openImage(event: MouseEvent) {
  if (!(event.target instanceof Element)) return;
  const image = event.target.closest(".md img");
  if (!(image instanceof HTMLImageElement) || image.closest("a")) return;
  const src = image.currentSrc || image.src;
  if (!src) return;
  event.preventDefault();
  preview.value = { src, alt: image.alt };
}

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
  <div
    ref="root"
    class="md md-article"
    @click="openImage"
    @error.capture="replaceBrokenImage"
    v-html="html"
  />
  <ImageModal v-if="preview" :src="preview.src" :alt="preview.alt" @close="preview = undefined" />
  <MermaidModal
    v-if="mermaidPreview !== undefined"
    :source="mermaidPreview"
    @close="mermaidPreview = undefined"
  />
</template>
