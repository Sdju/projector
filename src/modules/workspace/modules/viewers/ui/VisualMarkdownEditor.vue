<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { Crepe } from "@milkdown/crepe";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { htmlSchema } from "@milkdown/kit/preset/commonmark";
import { remarkImageBlockPlugin } from "@milkdown/kit/component/image-block";
import { Plugin } from "@milkdown/kit/prose/state";
import type { Node } from "@milkdown/kit/prose/model";
import { $prose, $view, replaceAll } from "@milkdown/kit/utils";
import { workspaceAssetUrl } from "../../../../workspace-api/index.ts";
import { loadGithubEmojis } from "../../../../../common/utilities/github-emoji.ts";
import {
  addFrontmatterEntry,
  parseFrontmatter,
  removeFrontmatterEntry,
  setFrontmatterValue,
  splitFrontmatter,
  type Frontmatter,
} from "../lib/frontmatter.ts";
import { markdownPath, renderMarkdown } from "../lib/markdown.ts";
import { githubEmojiDecorations } from "../lib/markdown-emoji.ts";
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
  source: [];
}>();
const root = ref<HTMLElement>();
const loading = ref(true);
let crepe: Crepe | undefined;
let ready = false;
let disposed = false;
let applying = false;
// Frontmatter lives outside the editor: ProseMirror would turn `---` into a rule and the keys into a heading.
const initial = split(props.content);
const frontmatter = ref<Frontmatter | undefined>(initial.frontmatter);
let currentContent = props.content;
let baselineContent = initial.body;
let currentBody = initial.body;
const newKey = ref<string>();
const vFocus = { mounted: (element: HTMLElement) => element.focus() };
let baselineDocument: Node | undefined;
const { linkMouseDown, followLink } = useMarkdownInteractions({
  root,
  path: () => props.path,
  editable: () => props.editable,
  editor: () => crepe,
  open: (path) => emit("open", path),
});

function split(content: string) {
  return props.compact ? { body: content } : splitFrontmatter(content);
}
function applyFrontmatter(raw: string | undefined) {
  if (raw === undefined || !frontmatter.value || raw === frontmatter.value.raw) return false;
  frontmatter.value = parseFrontmatter(raw);
  currentContent = raw + currentBody;
  emit("change", currentContent);
  return true;
}
function editValue(index: number, event: Event) {
  const field = event.target as HTMLTextAreaElement;
  const current = frontmatter.value!.entries[index]!.value;
  applyFrontmatter(setFrontmatterValue(frontmatter.value!, index, field.value));
  // Значение, которое YAML-слой не принял, возвращаем к тому, что в файле.
  field.value = frontmatter.value!.entries[index]?.value ?? current;
}
function removeEntry(index: number) {
  applyFrontmatter(removeFrontmatterEntry(frontmatter.value!, index));
}
async function commitKey() {
  const key = newKey.value?.trim();
  newKey.value = undefined;
  if (!key || !frontmatter.value) return;
  if (!applyFrontmatter(addFrontmatterEntry(frontmatter.value, key))) return;
  await nextTick();
  root.value?.parentElement
    ?.querySelector<HTMLTextAreaElement>(".frontmatter dd:last-of-type textarea")
    ?.focus();
}
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
  currentBody = markdown;
  markdown = (frontmatter.value?.raw ?? "") + markdown;
  if (markdown === currentContent) return;
  currentContent = markdown;
  emit("change", markdown);
}

onMounted(async () => {
  if (!root.value) return;
  const editor = createCrepe({
    root: root.value,
    content: baselineContent,
    editable: props.editable !== false,
    imageUrl,
  });
  crepe = editor;
  editor.editor.use(normalizeImageAttributes);
  // Only a readonly document (issue, comment) shows emoji images; an edited file stays as typed.
  if (props.editable === false) editor.editor.use(githubEmojiDecorations(await loadGithubEmojis()));
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
  const { frontmatter: head, body } = split(content);
  frontmatter.value = head;
  currentContent = content;
  currentBody = body;
  if (body === baselineContent) return;
  applying = true;
  try {
    crepe.editor.action(replaceAll(body));
    baselineContent = body;
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
    <details v-if="frontmatter" class="frontmatter" open>
      <summary>
        <span>Свойства</span>
        <button
          v-if="editable"
          type="button"
          class="frontmatter-edit"
          @click.prevent="emit('source')"
        >
          Изменить в исходнике
        </button>
      </summary>
      <dl v-if="frontmatter.entries.length">
        <template v-for="(entry, index) in frontmatter.entries" :key="`${index}:${entry.key}`">
          <dt>
            <span>{{ entry.key }}</span>
            <button
              v-if="editable"
              type="button"
              class="frontmatter-remove"
              :aria-label="`Удалить свойство ${entry.key}`"
              @click="removeEntry(index)"
            >
              ×
            </button>
          </dt>
          <dd>
            <textarea
              v-if="editable"
              :value="entry.value"
              rows="1"
              spellcheck="false"
              :aria-label="entry.key"
              @change="editValue(index, $event)"
            />
            <template v-else>{{ entry.value }}</template>
          </dd>
        </template>
      </dl>
      <p v-else class="frontmatter-empty">Пустой блок</p>
      <div v-if="editable" class="frontmatter-add">
        <input
          v-if="newKey !== undefined"
          v-model="newKey"
          v-focus
          placeholder="Имя свойства"
          aria-label="Имя нового свойства"
          @keydown.enter.prevent="commitKey"
          @keydown.esc.prevent="newKey = undefined"
          @blur="commitKey"
        />
        <button v-else type="button" @click="newKey = ''">+ Свойство</button>
      </div>
    </details>
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
.frontmatter {
  max-width: calc(820px - 2 * clamp(32px, 4vw, 56px));
  margin: 28px auto -12px;
  width: calc(100% - 2 * clamp(32px, 4vw, 56px));
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg-2);
  font-size: var(--fs-sm);
}
.frontmatter summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-2) var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-xs);
  cursor: pointer;
  user-select: none;
}
.frontmatter-edit {
  color: var(--muted);
  text-decoration: underline;
}
.frontmatter-edit:hover {
  color: var(--text);
}
.frontmatter dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sp-1) var(--sp-4);
  margin: 0;
  padding: var(--sp-1) var(--sp-3) var(--sp-3);
  border-top: 1px solid var(--line);
  padding-top: var(--sp-3);
}
.frontmatter dt {
  color: var(--muted);
  font-family: var(--mono);
  font-size: var(--fs-xs);
  line-height: 1.6;
}
.frontmatter dd {
  margin: 0;
  min-width: 0;
  white-space: pre-line;
  overflow-wrap: anywhere;
  line-height: 1.6;
}
.frontmatter dt {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-1);
}
.frontmatter-remove {
  color: var(--faint);
  line-height: 1.6;
  opacity: 0;
}
.frontmatter dt:hover .frontmatter-remove,
.frontmatter-remove:focus-visible {
  opacity: 1;
}
.frontmatter-remove:hover {
  color: var(--err);
}
.frontmatter textarea {
  display: block;
  width: 100%;
  min-height: 0;
  padding: 0 var(--sp-1);
  margin: 0 calc(-1 * var(--sp-1));
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: 1.6;
  resize: none;
  field-sizing: content;
}
.frontmatter textarea:hover {
  border-color: var(--line);
}
.frontmatter textarea:focus {
  border-color: var(--info);
  outline: none;
  background: var(--bg-sunken);
}
.frontmatter-add {
  padding: 0 var(--sp-3) var(--sp-2);
  font-size: var(--fs-xs);
}
.frontmatter-add button {
  color: var(--muted);
}
.frontmatter-add button:hover {
  color: var(--text);
}
.frontmatter-add input {
  width: 200px;
  font-family: var(--mono);
  font-size: var(--fs-xs);
}
.frontmatter-empty {
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
  color: var(--muted);
}
@media (max-width: 700px) {
  .frontmatter {
    margin: var(--sp-4) var(--sp-4) 0;
    width: auto;
  }
  .frontmatter dl {
    grid-template-columns: 1fr;
  }
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
