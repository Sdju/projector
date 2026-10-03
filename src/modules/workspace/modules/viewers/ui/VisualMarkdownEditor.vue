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
import { copyWithNotice, notify } from "../../../../../common/utilities/notice.ts";
import { workspaceAssetUrl } from "../../../../workspace-api/index.ts";
import { markdownPath, renderMarkdown } from "../lib/markdown.ts";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/classic-dark.css";

const props = withDefaults(
  defineProps<{ content: string; path: string; projectId: string; editable?: boolean }>(),
  { editable: true },
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

function imageUrl(url: string) {
  const path = markdownPath(url, props.path);
  if (path) return workspaceAssetUrl(props.projectId, path);
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
  const editor = new Crepe({
    root: root.value,
    defaultValue: currentContent,
    features: {
      [Crepe.Feature.Latex]: false,
      [Crepe.Feature.Toolbar]: props.editable !== false,
      [Crepe.Feature.BlockEdit]: props.editable !== false,
    },
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
function linkMouseDown(event: MouseEvent) {
  if (event.button !== 0 || (!event.ctrlKey && !event.metaKey)) return;
  if (!(event.target instanceof Element)) return;
  const link = event.target.closest("a");
  if (!link) return;
  if (/^(https?:|mailto:|\/\/)/i.test(link.getAttribute("href") ?? "")) {
    event.stopPropagation();
    return;
  }
  // Keep the editor selection and its floating link tooltip in place until click.
  event.preventDefault();
  event.stopPropagation();
}
function codeBlockText(block: Element) {
  let text: string | undefined;
  crepe?.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    view.state.doc.descendants((node, pos) => {
      if (text !== undefined) return false;
      if (node.type.name === "code_block" && view.nodeDOM(pos) === block) text = node.textContent;
    });
  });
  return text;
}
function copyCode(event: MouseEvent) {
  if (!(event.target instanceof Element)) return false;
  const button = event.target.closest<HTMLElement>(".milkdown-code-block .copy-button");
  const block = button?.closest(".milkdown-code-block");
  if (!button || !block) return false;
  // Milkdown only logs clipboard failures to the console, so copy here to report them.
  event.stopPropagation();
  const text = codeBlockText(block);
  if (text === undefined) notify(button, "Не удалось получить код блока", "error");
  else void copyWithNotice(button, text, "Код скопирован", "Не удалось скопировать код");
  return true;
}
function followLink(event: MouseEvent) {
  if (copyCode(event)) return;
  if (!(event.target instanceof Element) || event.button !== 0) return;
  const link = event.target.closest("a");
  if (!link) return;
  const href = link.getAttribute("href") ?? "";
  const preview = props.editable === false || !!link.closest(".milkdown-link-preview");
  const external = /^(https?:|mailto:|\/\/)/i.test(href);
  if (external && (event.ctrlKey || event.metaKey || preview)) {
    // Preserve the browser's native anchor navigation and its user gesture.
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    event.stopPropagation();
    return;
  }
  // Document text stays editable; the floating preview is already a navigation control.
  event.preventDefault();
  if (!event.ctrlKey && !event.metaKey && !preview) return;
  event.stopPropagation();
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
  }
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

<style scoped src="./VisualMarkdownEditor.css" />
