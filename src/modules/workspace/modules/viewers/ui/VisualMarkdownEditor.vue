<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { Crepe } from "@milkdown/crepe";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { htmlSchema } from "@milkdown/kit/preset/commonmark";
import { remarkImageBlockPlugin } from "@milkdown/kit/component/image-block";
import { Plugin } from "@milkdown/kit/prose/state";
import type { Node } from "@milkdown/kit/prose/model";
import { $prose, $view, replaceAll } from "@milkdown/kit/utils";
import { workspaceAssetUrl } from "../../../../workspace-api/index.ts";
import { markdownPath, renderMarkdown } from "../lib/markdown.ts";
import { createCrepe, normalizeImageAttributes } from "../lib/crepe-options.ts";
import { useMarkdownInteractions } from "../lib/markdown-links.ts";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/classic-dark.css";

const props = withDefaults(
  defineProps<{
    content: string;
    path: string;
    projectId: string;
    editable?: boolean;
    /** Без полей документа: рендер встроенного блока (issue, комментарий). */
    compact?: boolean;
  }>(),
  { editable: true, compact: false },
);
const emit = defineEmits<{
  change: [content: string];
  open: [path: string];
  error: [message: string];
}>();
const root = ref<HTMLElement>();
const loading = ref(true);
let crepe: Crepe | undefined;
let ready = false;
let disposed = false;
let applying = false;
let currentContent = props.content;
let baselineContent = props.content;
let baselineDocument: Node | undefined;
const { linkMouseDown, followLink } = useMarkdownInteractions({
  root,
  path: () => props.path,
  editable: () => props.editable,
  editor: () => crepe,
  open: (path) => emit("open", path),
});

function imageUrl(url: string) {
  const path = markdownPath(url, props.path);
  if (path) return workspaceAssetUrl(props.projectId, path);
  return /^(https?:|data:image\/(?:png|jpeg|gif|webp|avif);base64,)/i.test(url) ? url : "";
}
function publish(doc: Node, serialize: (doc: Node) => string) {
  if (!ready || applying || props.editable === false) return;
  let markdown = doc.eq(baselineDocument!) ? baselineContent : serialize(doc);
  if (!doc.eq(baselineDocument!)) {
    if (!baselineContent.endsWith("\n")) markdown = markdown.replace(/\n$/, "");
    if (baselineContent.includes("\r\n")) markdown = markdown.replace(/\r?\n/g, "\r\n");
  }
  if (markdown === currentContent) return;
  currentContent = markdown;
  emit("change", markdown);
}

onMounted(async () => {
  if (!root.value) return;
  const editor = createCrepe({
    root: root.value,
    content: currentContent,
    editable: props.editable !== false,
    imageUrl,
  });
  crepe = editor;
  editor.editor.use(normalizeImageAttributes);
  editor.editor
    .use(
      $prose(
        (ctx) =>
          new Plugin({
            view: () => ({
              update(view, previous) {
                // Capture every document transaction immediately: the built-in listener
                // is debounced and can miss the last edit before Save or a tab switch.
                if (!view.state.doc.eq(previous.doc))
                  publish(view.state.doc, ctx.get(serializerCtx));
              },
            }),
          }),
      ),
    )
    .use(
      $view(htmlSchema.node, () => (node) => {
        const dom = document.createElement("span");
        dom.className = "markdown-html";
        dom.contentEditable = "false";
        dom.innerHTML = renderMarkdown(String(node.attrs.value), props.path, props.projectId);
        return { dom, ignoreMutation: () => true };
      }),
    );
  try {
    // Keep ordinary Markdown images (including their alt text) as images;
    // Crepe's block conversion replaces alt text with a resize ratio.
    await editor.editor.remove(remarkImageBlockPlugin);
    if (disposed) return;
    await editor.create();
    editor.setReadonly(props.editable === false);
    if (disposed) {
      await editor.destroy();
      return;
    }
    editor.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      baselineDocument = view.state.doc;
      view.dom.setAttribute("role", "textbox");
      view.dom.setAttribute(
        "aria-label",
        props.editable === false ? "Просмотр документа Markdown" : "Редактор документа Markdown",
      );
      view.dom.setAttribute("aria-readonly", String(props.editable === false));
      view.dom.setAttribute("aria-multiline", "true");
      view.dom.setAttribute("spellcheck", "true");
    });
    ready = true;
    // Props may change while the asynchronously created editor is mounting.
    if (props.content !== currentContent) setContent(props.content);
  } catch (error) {
    if (!disposed)
      emit(
        "error",
        error instanceof Error ? error.message : "Не удалось открыть визуальный редактор",
      );
  } finally {
    loading.value = false;
  }
});

function setContent(content: string) {
  if (!ready || !crepe || content === currentContent) return;
  applying = true;
  currentContent = content;
  try {
    crepe.editor.action(replaceAll(content));
    baselineContent = content;
    crepe.editor.action((ctx) => {
      baselineDocument = ctx.get(editorViewCtx).state.doc;
    });
  } finally {
    applying = false;
  }
}
watch(() => props.content, setContent);
watch(
  () => props.editable,
  (editable) => crepe?.setReadonly(editable === false),
);
onBeforeUnmount(() => {
  disposed = true;
  ready = false;
  if (crepe && !loading.value) void crepe.destroy();
});
</script>

<template>
  <div
    class="visual-markdown"
    :class="{ compact }"
    @mousedown.capture="linkMouseDown"
    @click.capture="followLink"
  >
    <p v-if="loading" class="editor-loading" role="status">Открываю документ…</p>
    <div ref="root" class="visual-markdown-root" />
  </div>
</template>

<style scoped>
.visual-markdown {
  min-height: 0;
  min-width: 0;
  height: 100%;
  overflow: auto;
}
.editor-loading {
  color: var(--muted);
  padding: var(--sp-4) var(--sp-5);
  font-size: var(--fs-xs);
}
.visual-markdown-root {
  min-height: 100%;
}
.visual-markdown :deep(.milkdown) {
  --crepe-color-background: var(--bg);
  --crepe-color-on-background: var(--text);
  --crepe-color-surface: var(--bg-2);
  --crepe-color-surface-low: var(--bg-3);
  --crepe-color-on-surface: var(--text);
  --crepe-color-on-surface-variant: var(--muted);
  /* Crepe also uses outline for icons, input carets and drag handles. */
  --crepe-color-outline: var(--muted);
  --crepe-color-primary: var(--info);
  --crepe-color-secondary: var(--bg-4);
  --crepe-color-on-secondary: var(--text);
  --crepe-color-hover: var(--bg-3);
  --crepe-color-selected: var(--selection);
  --crepe-color-inline-area: var(--bg-3);
  --crepe-font-title: var(--sans);
  --crepe-font-default: var(--sans);
  --crepe-font-code: var(--mono);
  --crepe-shadow-1: var(--shadow-popover);
  --crepe-shadow-2: var(--shadow-popover);
  min-height: 100%;
  font-size: var(--fs-md);
}
.visual-markdown :deep(.ProseMirror) {
  max-width: 820px;
  margin: 0 auto;
  min-height: 100%;
  padding: 28px clamp(32px, 4vw, 56px) 80px;
  line-height: 1.8;
  outline: none; /* каретка — собственный virtual cursor Prosemirror */
}
.visual-markdown :deep(.ProseMirror-focused) {
  --prosemirror-virtual-cursor-color: var(--text);
}
.visual-markdown :deep(.prosemirror-virtual-cursor) {
  /* Positioned blocks such as quotes must not paint over the caret. */
  z-index: 1;
}
.visual-markdown :deep(.ProseMirror h1),
.visual-markdown :deep(.ProseMirror h2) {
  padding-bottom: 0.35em;
  border-bottom: 1px solid var(--line);
  font-weight: 650;
  letter-spacing: -0.02em;
}
.visual-markdown :deep(.ProseMirror h1) {
  font-size: var(--fs-xl);
  line-height: 1.35;
}
.visual-markdown :deep(.ProseMirror h2) {
  font-size: var(--fs-lg);
  line-height: 1.4;
}
.visual-markdown :deep(.ProseMirror p) {
  font-size: var(--fs-md);
  line-height: 1.8;
}
.visual-markdown :deep(.ProseMirror a) {
  color: var(--info);
  text-underline-offset: 3px;
}
.visual-markdown :deep(.ProseMirror blockquote) {
  border-left: 3px solid var(--line-strong);
  background: var(--bg-2);
  padding: 4px 20px;
}
.visual-markdown :deep(.ProseMirror img) {
  max-width: 100%;
}
.visual-markdown :deep(.milkdown-table-block table) {
  /* Колонки учитывают содержимое вместо одинаковой фиксированной ширины. */
  table-layout: auto;
}
.visual-markdown :deep(.milkdown-table-block th),
.visual-markdown :deep(.milkdown-table-block td) {
  overflow-wrap: anywhere;
}
.visual-markdown :deep(.markdown-html) {
  display: inline-block;
  max-width: 100%;
}
.visual-markdown :deep(.markdown-html p) {
  margin: 0;
}
.visual-markdown :deep(input[type="checkbox"]) {
  width: auto;
  accent-color: var(--run);
}
.visual-markdown :deep(.milkdown .milkdown-code-block) {
  margin: var(--sp-3) 0;
  padding: 0;
  /* Без overflow: hidden — иначе список языка (.language-picker) режется границей блока. */
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg-sunken);
  transition: border-color var(--t-fast);
}
.visual-markdown :deep(.milkdown .milkdown-code-block:hover) {
  border-color: var(--line-strong);
}
.visual-markdown :deep(.milkdown .milkdown-code-block.selected) {
  border-color: var(--info);
  outline: none;
}
/* Шапка блока: язык слева, копирование справа; видна всегда, а не только по наведению. */
.visual-markdown :deep(.milkdown-code-block .tools) {
  min-height: 32px;
  padding: 0 var(--sp-2) 0 var(--sp-1);
  border-bottom: 1px solid var(--line);
  border-radius: var(--r-md) var(--r-md) 0 0;
  background: var(--bg-2);
}
.visual-markdown :deep(.milkdown-code-block .cm-editor) {
  border-radius: 0 0 var(--r-md) var(--r-md);
}
.visual-markdown :deep(.milkdown-code-block .tools .language-button) {
  margin: 0;
  padding: 2px var(--sp-1) 2px var(--sp-2);
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--muted);
  font: var(--fs-2xs) var(--mono);
  font-weight: 500;
  letter-spacing: var(--track-label);
  text-transform: lowercase;
  opacity: 1;
}
.visual-markdown :deep(.milkdown-code-block .tools .language-button:hover) {
  background: var(--hover);
  color: var(--text);
}
.visual-markdown :deep(.milkdown-code-block .tools .tools-button-group button) {
  padding: 2px var(--sp-2);
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--muted);
  font: var(--fs-2xs) var(--sans);
  opacity: 0;
  transition:
    opacity var(--t-fast),
    background var(--t-fast),
    color var(--t-fast);
}
.visual-markdown :deep(.milkdown-code-block .tools .tools-button-group button svg) {
  fill: currentColor;
}
.visual-markdown :deep(.milkdown-code-block .tools .tools-button-group button:hover),
.visual-markdown :deep(.milkdown-code-block .tools .tools-button-group button:focus-visible) {
  background: var(--hover);
  color: var(--text);
  opacity: 1;
}
.visual-markdown :deep(.milkdown-code-block:hover .tools-button-group > button),
.visual-markdown :deep(.milkdown-code-block:focus-within .tools-button-group > button) {
  opacity: 1;
}
.visual-markdown :deep(.milkdown-code-block .cm-editor),
.visual-markdown :deep(.milkdown-code-block .cm-gutters) {
  background: transparent;
}
.visual-markdown :deep(.milkdown-code-block .list-wrapper) {
  z-index: var(--z-popover);
}
.visual-markdown :deep(.milkdown-code-block .cm-scroller) {
  padding: var(--sp-2) 0;
  line-height: 1.6;
}
.visual-markdown :deep(.milkdown-code-block .cm-content) {
  font: var(--fs-sm) var(--mono);
}
.visual-markdown :deep(.milkdown-code-block .cm-gutters) {
  color: var(--faint);
  font: var(--fs-2xs) var(--mono);
}
.visual-markdown :deep(.milkdown-code-block .cm-activeLine),
.visual-markdown :deep(.milkdown-code-block .cm-activeLineGutter) {
  background: var(--hover);
}
.visual-markdown :deep(.milkdown-code-block .cm-selectionBackground) {
  background: var(--selection);
}
.visual-markdown :deep(.ProseMirror :not(pre) > code) {
  padding: 1px 6px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg-2);
  font: 0.9em var(--mono);
}
/* Встроенный readonly-блок: без полей документа, высота по содержимому. */
.visual-markdown.compact {
  height: auto;
  overflow: visible;
}
.visual-markdown.compact .visual-markdown-root {
  min-height: 0;
}
.visual-markdown.compact :deep(.milkdown) {
  min-height: 0;
  font-size: var(--fs-sm);
}
.visual-markdown.compact :deep(.ProseMirror) {
  max-width: none;
  margin: 0;
  min-height: 0;
  padding: 0;
  line-height: 1.6;
}
.visual-markdown.compact :deep(.ProseMirror h1),
.visual-markdown.compact :deep(.ProseMirror h2) {
  padding-bottom: 0;
  border-bottom: 0;
  font-size: var(--fs-md);
}
.visual-markdown.compact :deep(.ProseMirror p) {
  font-size: inherit;
  line-height: 1.6;
}
@media (max-width: 700px), (max-width: 1050px) and (max-height: 500px) and (pointer: coarse) {
  .visual-markdown :deep(.ProseMirror) {
    padding: var(--sp-4) var(--sp-4) var(--sp-6);
  }
  .visual-markdown :deep(.ProseMirror > :first-child) {
    margin-top: 0;
  }
  .visual-markdown :deep(.ProseMirror blockquote) {
    padding-inline: var(--sp-3);
  }
}
</style>
