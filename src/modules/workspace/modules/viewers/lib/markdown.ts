import { workspaceAssetUrl } from "../../../../workspace-api/index.ts";
import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import hljs from "highlight.js/lib/common";
import DOMPurify from "dompurify";

export function markdownPath(href: string, path: string): string | undefined {
  if (!href || href.startsWith("#") || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return;
  try {
    const url = new URL(href, `https://projector.invalid/${path}`);
    const result = decodeURIComponent(url.pathname.slice(1));
    if (result.split("/").includes("..") || result.includes("\0") || result.includes("\\")) return;
    return result;
  } catch {
    return;
  }
}

export function renderMarkdown(content: string, path: string, projectId: string) {
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
    if (target) image.setAttribute("src", workspaceAssetUrl(projectId, target));
    image.setAttribute("loading", "lazy");
  }
  return document.innerHTML;
}
