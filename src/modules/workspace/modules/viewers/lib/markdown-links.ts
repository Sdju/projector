import type { Ref } from "vue";
import type { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { copyWithNotice, notify } from "../../../../../common/utilities/notice.ts";
import { markdownPath } from "./markdown.ts";

/** Pointer handling of the visual editor: link navigation and the code-block copy button. */
export function useMarkdownInteractions(options: {
  root: Ref<HTMLElement | undefined>;
  path: () => string;
  editable: () => boolean | undefined;
  editor: () => Crepe | undefined;
  open: (path: string) => void;
}) {
  const { root, editable, editor, open } = options;
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
    editor()?.editor.action((ctx) => {
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
    const preview = editable() === false || !!link.closest(".milkdown-link-preview");
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
    const path = link.dataset.workspacePath ?? markdownPath(href, options.path());
    if (path) open(path);
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
  return { linkMouseDown, followLink };
}
