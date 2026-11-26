import { onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import type { Crepe } from "@milkdown/crepe";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { htmlSchema } from "@milkdown/kit/preset/commonmark";
import { remarkImageBlockPlugin } from "@milkdown/kit/component/image-block";
import { Plugin } from "@milkdown/kit/prose/state";
import type { Node } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose, $view, replaceAll } from "@milkdown/kit/utils";
import { workspaceAssetUrl, workspaceScopeAssetUrl } from "../../../../workspace-api/index.ts";
import type { FileScope } from "@ai-projector/core/modules/workspace/index.ts";
import { loadGithubEmojis } from "../../../../../common/utilities/github-emoji.ts";
import { parseFrontmatter, splitFrontmatter, type Frontmatter } from "./frontmatter.ts";
import { markdownPath, renderMarkdown, stripImageAttributes } from "./markdown.ts";
import { githubEmojiDecorations } from "./markdown-emoji.ts";
import { createCrepe, normalizeImageAttributes } from "./crepe-options.ts";
import { editorTheme } from "./editor-theme.ts";
import { appearanceFonts } from "../../../../appearance/index.ts";
import type { EmojiMap } from "../../../../../common/utilities/github-emoji.ts";
import { useMarkdownInteractions } from "./markdown-links.ts";
import { injectEditorSelection } from "./editor-selection.ts";

export interface VisualMarkdownOptions {
  readonly content: string;
  readonly path: string;
  readonly projectId: string;
  readonly scope?: FileScope;
  readonly editable?: boolean;
  readonly compact?: boolean;
}

export interface VisualMarkdownCallbacks {
  onChange: (value: string) => void;
  onOpen: (value: string) => void;
  onError: (value: string) => void;
  onSource: () => void;
  onReady: () => void;
  onCommand: (id: string, args?: unknown) => void;
}

export function useVisualMarkdownEditor(
  props: VisualMarkdownOptions,
  root: Readonly<Ref<HTMLElement | undefined>>,
  callbacks: VisualMarkdownCallbacks,
) {
  const mermaidPreview = ref<string>();
  const loading = ref(true);
  let crepe: Crepe | undefined;
  let prose: EditorView | undefined;
  let scroller: HTMLElement | null = null;
  let selectionFrame = 0;
  const editorSelection = injectEditorSelection();
  let ready = false;
  let disposed = false;
  let applying = false;
  // Frontmatter lives outside the editor: ProseMirror would turn `---` into a rule and the keys into a heading.
  const initial = split(props.content);
  const frontmatter = ref<Frontmatter | undefined>(initial.frontmatter);
  let currentContent = props.content;
  let baselineContent = initial.body;
  let currentBody = initial.body;
  let emojiMap: EmojiMap = {};
  let baselineDocument: Node | undefined;
  const { linkMouseDown, followLink } = useMarkdownInteractions({
    root,
    path: () => props.path,
    editable: () => props.editable,
    editor: () => crepe,
    open: (path) => callbacks.onOpen(path),
  });

  function mermaidClick(event: MouseEvent) {
    if (!(event.target instanceof Element)) return;
    const action = event.target.closest(".mermaid-action");
    const diagram = event.target.closest<HTMLElement>(".mermaid-diagram");
    const canvas = event.target.closest(".mermaid-canvas");
    if (!diagram || (!action && !canvas) || (!action && event.target.closest("a, button, input")))
      return;
    event.preventDefault();
    event.stopPropagation();
    if (action?.getAttribute("aria-label") === "Редактировать исходный код") callbacks.onSource();
    else {
      const block = diagram.closest(".milkdown-code-block");
      const position = block && prose ? prose.posAtDOM(block, 0) : -1;
      mermaidPreview.value = prose?.state.doc.resolve(position).nodeAfter?.textContent ?? "";
    }
  }

  function editorClick(event: MouseEvent) {
    mermaidClick(event);
    if (!event.defaultPrevented) followLink(event);
  }

  function split(content: string) {
    const parts = props.compact ? { body: content } : splitFrontmatter(content);
    return props.editable === false ? { ...parts, body: stripImageAttributes(parts.body) } : parts;
  }
  function applyFrontmatter(raw: string) {
    if (!frontmatter.value || raw === frontmatter.value.raw) return;
    frontmatter.value = parseFrontmatter(raw);
    currentContent = raw + currentBody;
    callbacks.onChange(currentContent);
  }
  function imageUrl(url: string) {
    const path = markdownPath(url, props.path);
    if (path)
      return props.scope
        ? workspaceScopeAssetUrl(props.projectId, props.scope, path)
        : workspaceAssetUrl(props.projectId, path);
    return /^(https?:|data:image\/(?:png|jpeg|gif|webp|avif);base64,)/i.test(url) ? url : "";
  }
  /** The workspace command and `Mod+Shift+L` read the same store; only a focused editor reports. */
  function scheduleSelectionReport() {
    cancelAnimationFrame(selectionFrame);
    selectionFrame = requestAnimationFrame(reportSelection);
  }
  function reportSelection() {
    const view = prose;
    if (!view || props.compact || !view.hasFocus()) {
      editorSelection?.clear(props.path);
      return;
    }
    const { from, to } = view.state.selection;
    if (from === to) {
      editorSelection?.clear(props.path);
      return;
    }
    const text = view.state.doc.textBetween(from, to, "\n", "\n").trim();
    if (text) editorSelection?.report({ path: props.path, text });
    else editorSelection?.clear(props.path);
  }
  /** The native Milkdown toolbar item and the hotkey both put the selected text into the chat. */
  function selectionToChat(text: string) {
    const body = text.trim();
    if (!body) return;
    if (editorSelection) {
      editorSelection.report({ path: props.path, text: body });
      editorSelection.add();
      return;
    }
    callbacks.onCommand("ide.editor.selection.toChat", {
      path: props.path,
      text: body,
      source: `Выделение из ${props.path}`,
    });
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
    callbacks.onChange(markdown);
  }

  onMounted(async () => {
    if (!root.value) return;
    const editor = createCrepe({
      root: root.value,
      content: baselineContent,
      editable: props.editable !== false,
      theme: editorTheme.value,
      fontSize: appearanceFonts.value.editor,
      imageUrl,
      selectionToChat,
    });
    crepe = editor;
    editor.editor.use(normalizeImageAttributes);
    // Only a readonly document (issue, comment) shows emoji images; an edited file stays as typed.
    if (props.editable === false) {
      emojiMap = await loadGithubEmojis();
      editor.editor.use(githubEmojiDecorations(emojiMap));
    }
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
                  if (!view.state.selection.eq(previous.selection)) scheduleSelectionReport();
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
          dom.innerHTML = renderMarkdown(
            String(node.attrs.value),
            props.path,
            props.projectId,
            emojiMap,
            props.scope,
          );
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
        prose = view;
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
      scroller = root.value?.parentElement ?? null;
      document.addEventListener("selectionchange", scheduleSelectionReport);
      scroller?.addEventListener("focusout", scheduleSelectionReport);
      scroller?.addEventListener("focusin", scheduleSelectionReport);
      ready = true;
      callbacks.onReady();
      // Props may change while the asynchronously created editor is mounting.
      if (props.content !== currentContent) setContent(props.content);
    } catch (error) {
      if (!disposed)
        callbacks.onError(
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
    cancelAnimationFrame(selectionFrame);
    document.removeEventListener("selectionchange", scheduleSelectionReport);
    scroller?.removeEventListener("focusout", scheduleSelectionReport);
    scroller?.removeEventListener("focusin", scheduleSelectionReport);
    scroller = null;
    prose = undefined;
    editorSelection?.clear(props.path);
    if (crepe && !loading.value) void crepe.destroy();
  });
  return {
    mermaidPreview,
    loading,
    frontmatter,
    applyFrontmatter,
    linkMouseDown,
    editorClick,
  };
}
