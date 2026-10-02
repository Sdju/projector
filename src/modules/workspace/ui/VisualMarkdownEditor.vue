<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Crepe } from "@milkdown/crepe";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { htmlSchema } from "@milkdown/kit/preset/commonmark";
import { remarkImageBlockPlugin } from "@milkdown/kit/component/image-block";
import { Plugin } from "@milkdown/kit/prose/state";
import type { Node } from "@milkdown/kit/prose/model";
import { $prose, $remark, $view, replaceAll } from "@milkdown/kit/utils";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import { markdownPath, renderMarkdown } from "../lib/markdown.ts";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/classic-dark.css";

const props = defineProps<{ content: string; path: string; projectId: string }>();
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

function imageUrl(url: string) {
  const path = markdownPath(url, props.path);
  if (path)
    return `/api/projects/${encodeURIComponent(props.projectId)}/workspace/asset?${new URLSearchParams({ path })}`;
  return /^(https?:|data:image\/(?:png|jpeg|gif|webp|avif);base64,)/i.test(url) ? url : "";
}
function embedImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Не удалось прочитать изображение"));
    reader.readAsDataURL(file);
  });
}
function publish(doc: Node, serialize: (doc: Node) => string) {
  if (!ready || applying) return;
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
  const editor = new Crepe({
    root: root.value,
    defaultValue: currentContent,
    features: { [Crepe.Feature.Latex]: false },
    featureConfigs: {
      [Crepe.Feature.Placeholder]: { text: "Начните писать…" },
      [Crepe.Feature.Toolbar]: {
        boldLabel: "Жирный",
        italicLabel: "Курсив",
        strikethroughLabel: "Зачёркнутый",
        codeLabel: "Код",
        linkLabel: "Ссылка",
      },
      [Crepe.Feature.LinkTooltip]: { inputPlaceholder: "Адрес ссылки" },
      [Crepe.Feature.ImageBlock]: {
        proxyDomURL: imageUrl,
        onUpload: embedImage,
        inlineUploadPlaceholderText: "или вставьте ссылку",
        blockUploadPlaceholderText: "или вставьте ссылку",
        blockCaptionPlaceholderText: "Подпись изображения",
        blockConfirmButton: "Вставить",
      },
      [Crepe.Feature.CodeMirror]: {
        languages,
        theme: oneDark,
        searchPlaceholder: "Язык кода",
        copyText: "Копировать",
        noResultText: "Не найдено",
      },
    },
  });
  crepe = editor;
  // Remark uses null for an omitted image title, while Milkdown 7.22's
  // image schemas require strings. Normalize it before schema validation.
  editor.editor.use(
    $remark("projectorImageAttributes", () => () => (tree) => {
      function normalize(node: {
        type: string;
        title?: unknown;
        alt?: unknown;
        children?: Parameters<typeof normalize>[0][];
      }) {
        if (node.type === "image" || node.type === "image-block") {
          node.title ??= "";
          node.alt ??= "";
        }
        node.children?.forEach(normalize);
      }
      normalize(tree);
    }),
  );
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
    if (disposed) {
      await editor.destroy();
      return;
    }
    editor.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      baselineDocument = view.state.doc;
      view.dom.setAttribute("role", "textbox");
      view.dom.setAttribute("aria-label", "Редактор документа Markdown");
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
function linkMouseDown(event: MouseEvent) {
  if (event.button !== 0 || (!event.ctrlKey && !event.metaKey)) return;
  if (!(event.target instanceof Element) || !event.target.closest("a")) return;
  // Keep the editor selection and its floating link tooltip in place until click.
  event.preventDefault();
  event.stopPropagation();
}
function followLink(event: MouseEvent) {
  if (!(event.target instanceof Element) || event.button !== 0) return;
  const link = event.target.closest("a");
  if (!link) return;
  // Document text stays editable; the floating preview is already a navigation control.
  event.preventDefault();
  if (!event.ctrlKey && !event.metaKey && !link.closest(".milkdown-link-preview")) return;
  event.stopPropagation();
  const href = link.getAttribute("href") ?? "";
  const path = link.dataset.workspacePath ?? markdownPath(href, props.path);
  if (path) emit("open", path);
  else if (href.startsWith("#")) {
    const slug = decodeURIComponent(href.slice(1));
    const heading = [...(root.value?.querySelectorAll("h1,h2,h3,h4,h5,h6") ?? [])].find(
      (node) =>
        node.id === slug ||
        node.id === `md-${slug}` ||
        node.textContent
          ?.toLowerCase()
          .replace(/[^\p{L}\p{N}_\-\s]/gu, "")
          .replace(/\s+/g, "-") === slug,
    );
    heading?.scrollIntoView({ block: "start", behavior: "smooth" });
  } else if (/^(https?:|mailto:|\/\/)/i.test(href))
    window.open(href, "_blank", "noopener,noreferrer");
}
onBeforeUnmount(() => {
  disposed = true;
  ready = false;
  if (crepe && !loading.value) void crepe.destroy();
});
</script>

<template>
  <div class="visual-markdown" @mousedown.capture="linkMouseDown" @click.capture="followLink">
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
  padding: 16px 24px;
  font-size: 12px;
}
.visual-markdown-root {
  min-height: 100%;
}
.visual-markdown :deep(.milkdown) {
  --crepe-color-background: var(--bg);
  --crepe-color-on-background: var(--text);
  --crepe-color-surface: var(--bg-2);
  --crepe-color-surface-low: #20201c;
  --crepe-color-on-surface: var(--text);
  --crepe-color-on-surface-variant: var(--muted);
  /* Crepe also uses outline for icons, input carets and drag handles. */
  --crepe-color-outline: #b8b8ae;
  --crepe-color-primary: #a4c7e8;
  --crepe-color-secondary: #30302b;
  --crepe-color-on-secondary: var(--text);
  --crepe-color-hover: #242420;
  --crepe-color-selected: #3a3934;
  --crepe-color-inline-area: #24241f;
  --crepe-font-title: var(--sans);
  --crepe-font-default: var(--sans);
  --crepe-font-code: var(--mono);
  --crepe-shadow-1: 0 4px 16px #0005;
  --crepe-shadow-2: 0 8px 24px #0007;
  min-height: 100%;
  font-size: 15px;
}
.visual-markdown :deep(.ProseMirror) {
  max-width: 820px;
  margin: 0 auto;
  min-height: 100%;
  padding: 28px clamp(32px, 4vw, 56px) 80px;
  line-height: 1.8;
  outline: none;
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
  font-size: 30px;
  line-height: 1.35;
}
.visual-markdown :deep(.ProseMirror h2) {
  font-size: 23px;
  line-height: 1.4;
}
.visual-markdown :deep(.ProseMirror p) {
  font-size: 15px;
  line-height: 1.8;
}
.visual-markdown :deep(.ProseMirror a) {
  color: #a4c7e8;
  text-underline-offset: 3px;
}
.visual-markdown :deep(.ProseMirror blockquote) {
  border-left: 3px solid #66685a;
  background: var(--bg-2);
  padding: 4px 20px;
}
.visual-markdown :deep(.ProseMirror img) {
  max-width: 100%;
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
.visual-markdown :deep(.cm-editor) {
  background: #181a1c;
}
.visual-markdown :deep(.milkdown-code-block .cm-content) {
  font: 13px var(--mono);
}
</style>
