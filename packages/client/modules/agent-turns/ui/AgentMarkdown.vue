<script setup lang="ts">
import { inject, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { createMarkdownStream } from "../lib/markdown-stream.ts";
import { renderChatMarkdown } from "../lib/markdown.ts";
import { parseChatLink } from "../../agent-core/index.ts";
import { chatImageSource, chatProjectKey } from "../../chat-images/index.ts";
import { chatLinkActionsKey } from "../../agent-core/index.ts";
import { openExternalLink } from "../../../common/utilities/open-external-link.ts";
import ContextMenu from "../../../common/ui/ContextMenu.vue";
import "./agent-markdown.css";
import type { ContextMenuItem } from "../../../common/ui/context-menu.ts";
import ImageModal from "../../../common/ui/ImageModal.vue";
import { MermaidModal, createMermaidBlock, type MermaidBlock } from "../../markdown/index.ts";
import IconCopy from "~icons/lucide/copy";
import IconExternal from "~icons/lucide/external-link";
import IconFile from "~icons/lucide/file-text";

/**
 * A markdown text that grows: closed blocks stay as they were, only the last one is redone. While
 * the text streams, a render that took long (a big open code block) is followed by a pause three
 * times as long, so rendering never takes more than a quarter of the main thread.
 */
const props = defineProps<{ text: string; streaming?: boolean }>();
const projectId = inject(chatProjectKey, "");
const linkActions = inject(chatLinkActionsKey, undefined);
const stream = createMarkdownStream((markdown) =>
  renderChatMarkdown(markdown, { resolveImage: (src) => chatImageSource(src, projectId) }),
);
const root = ref<HTMLElement>();
const blocks = shallowRef(stream.update(props.text));
const preview = ref<{ src: string; alt: string }>();
const mermaidPreview = ref<string>();
const diagrams = new Set<MermaidBlock>();
const linkMenu = ref<InstanceType<typeof ContextMenu>>();
const linkMenuItems = ref<ContextMenuItem[]>([]);
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
function destroyDiagrams() {
  for (const diagram of diagrams) diagram.destroy();
  diagrams.clear();
}
watch(
  blocks,
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
onBeforeUnmount(() => {
  clearTimeout(timer);
  destroyDiagrams();
});

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

function linkAt(target: EventTarget | null): HTMLAnchorElement | undefined {
  if (!(target instanceof Element)) return;
  return target.closest<HTMLAnchorElement>(".md a[href], .md a[data-chat-file]") ?? undefined;
}

/** The markdown target: the sanitizer may have removed `href`, but the file path stays in data. */
function linkHref(anchor: HTMLAnchorElement): string {
  return anchor.dataset.chatFile || anchor.getAttribute("href") || "";
}

/** A click on a file link opens the file; web links keep the browser's new-tab action. */
function followLink(event: MouseEvent) {
  if (event.button !== 0 || event.defaultPrevented) return;
  const anchor = linkAt(event.target);
  if (!anchor) return;
  const link = parseChatLink(linkHref(anchor));
  if (link.kind !== "file") return;
  event.preventDefault();
  if (linkActions) void linkActions.openFile(link, anchor);
}

function handleClick(event: MouseEvent) {
  openImage(event);
  followLink(event);
}

function menuItems(link: ReturnType<typeof parseChatLink>, source: Element): ContextMenuItem[] {
  if (link.kind === "web")
    return [
      {
        id: "link.open",
        label: "Открыть в новой вкладке",
        icon: IconExternal,
        run: () => openExternalLink(link.href),
      },
      {
        id: "link.copyAddress",
        label: "Копировать адрес ссылки",
        icon: IconCopy,
        run: () => void linkActions?.copyAddress(link.href, source),
      },
    ];
  if (link.kind !== "file") return [];
  const items: ContextMenuItem[] = [
    {
      id: "link.openFile",
      label: "Открыть файл",
      icon: IconFile,
      run: () => void linkActions?.openFile(link, source),
    },
    {
      id: "link.copyAbsolute",
      label: "Копировать абсолютный путь",
      icon: IconCopy,
      separator: true,
      run: () => void linkActions?.copyAbsolute(link, source),
    },
  ];
  if (!link.external)
    items.push({
      id: "link.copyRelative",
      label: "Копировать относительный путь",
      icon: IconCopy,
      run: () => void linkActions?.copyRelative(link, source),
    });
  return items;
}

/** A right click on a link offers its actions; the browser menu is left to everything else. */
function openLinkMenu(event: MouseEvent) {
  const anchor = linkAt(event.target);
  if (!anchor) return;
  const link = parseChatLink(linkHref(anchor));
  const items = menuItems(link, anchor);
  if (!items.length) return;
  event.preventDefault();
  linkMenuItems.value = items;
  void nextTick(() => linkMenu.value?.open(event, anchor));
}
</script>

<template>
  <div
    ref="root"
    class="md"
    @click="handleClick"
    @contextmenu="openLinkMenu"
    @error.capture="replaceBrokenImage"
  >
    <div v-for="block in blocks" :key="block.key" class="md-block" v-html="block.html" />
  </div>
  <ImageModal v-if="preview" :src="preview.src" :alt="preview.alt" @close="preview = undefined" />
  <MermaidModal
    v-if="mermaidPreview !== undefined"
    :source="mermaidPreview"
    @close="mermaidPreview = undefined"
  />
  <ContextMenu v-if="linkMenuItems.length" ref="linkMenu" :items="linkMenuItems" label="Ссылка" />
</template>

<style scoped>
/* The blocks are only the unit of rendering: their content lays out as direct children of `.md`. */
.md-block {
  display: contents;
}
/* The sanitizer may drop href from a Windows path: the link still opens on click. */
.md :deep(a[data-chat-file]) {
  cursor: pointer;
}
</style>
