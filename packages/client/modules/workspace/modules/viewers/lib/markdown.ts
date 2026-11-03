import { workspaceAssetUrl, workspaceScopeAssetUrl } from "../../../../workspace-api/index.ts";
import type { FileScope } from "@projector/core/modules/workspace/index.ts";
import { markdownPath } from "../../../../../common/utilities/markdown-path.ts";
import { splitEmoji, type EmojiMap } from "../../../../../common/utilities/github-emoji.ts";
import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import hljs from "highlight.js/lib/common";
import DOMPurify from "dompurify";

export { markdownPath };

/** GitLab writes image dimensions after the image: `![](url){width=12}`. */
const IMAGE_ATTRIBUTES = /(!\[[^\]]*\]\([^)]*\))\{(?:width|height)=\d+\}/g;
/** Read-only cards do not resize images: drop the attribute text that Markdown keeps. */
export function stripImageAttributes(content: string) {
  return content.replace(IMAGE_ATTRIBUTES, "$1");
}

function decorateEmoji(root: HTMLElement, emojis: EmojiMap) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.nodeValue?.includes(":")) continue;
    if (node.parentElement?.closest("code, pre")) continue;
    nodes.push(node);
  }
  for (const node of nodes) {
    const parts = splitEmoji(node.nodeValue ?? "", emojis);
    if (parts.every((part) => typeof part === "string")) continue;
    const fragment = document.createDocumentFragment();
    for (const part of parts) {
      if (typeof part === "string") {
        fragment.append(part);
        continue;
      }
      const image = document.createElement("img");
      image.className = "github-emoji";
      image.src = part.url;
      image.alt = `:${part.name}:`;
      image.title = `:${part.name}:`;
      image.loading = "lazy";
      fragment.append(image);
    }
    node.replaceWith(fragment);
  }
}

export function renderMarkdown(
  content: string,
  path: string,
  projectId: string,
  emojis: EmojiMap = {},
  scope?: FileScope,
) {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    highlight(code, language) {
      if (language && hljs.getLanguage(language)) {
        try {
          return hljs.highlight(code, { language, ignoreIllegals: true }).value;
        } catch {
          /* Fall back to escaped plain text. */
        }
      }
      return "";
    },
  }).use(taskLists);
  const headings = new Map<string, number>();
  md.renderer.rules.heading_open = (tokens, index, options, _env, self) => {
    const title = tokens[index + 1]?.content ?? "";
    const slug = title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_\-\s]/gu, "")
      .replace(/\s+/g, "-");
    const count = headings.get(slug) ?? 0;
    headings.set(slug, count + 1);
    tokens[index]!.attrSet("id", `md-${slug}${count ? `-${count}` : ""}`);
    return self.renderToken(tokens, index, options);
  };
  const document = DOMPurify.sanitize(md.render(content), {
    USE_PROFILES: { html: true },
    RETURN_DOM: true,
  }) as HTMLElement;
  // Normalize both Markdown links and embedded HTML after sanitization.
  for (const link of document.querySelectorAll("a")) {
    link.removeAttribute("data-workspace-path");
    const href = link.getAttribute("href") ?? "";
    const target = markdownPath(href, path);
    if (target) {
      link.setAttribute("data-workspace-path", target);
      link.setAttribute("href", "#");
    } else if (href && !href.startsWith("#")) {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    }
  }
  for (const image of document.querySelectorAll("img")) {
    const target = markdownPath(image.getAttribute("src") ?? "", path);
    if (target)
      image.setAttribute(
        "src",
        scope
          ? workspaceScopeAssetUrl(projectId, scope, target)
          : workspaceAssetUrl(projectId, target),
      );
    image.setAttribute("loading", "lazy");
  }
  decorateEmoji(document, emojis);
  return document.innerHTML;
}
