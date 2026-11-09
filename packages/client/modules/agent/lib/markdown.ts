import MarkdownIt, { type Env } from "markdown-it";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import { parseChatLink } from "./chat-links.ts";

/** What a chat rendering needs to know beyond the text: where its images come from. */
export type MarkdownEnv = Env & {
  /** The URL an image is shown from; `undefined` renders its alt text instead of a broken icon. */
  resolveImage?: (src: string) => string | undefined;
};

const markdown = new MarkdownIt({
  // An answer may be written as HTML: DOMPurify still decides what reaches the page.
  html: true,
  linkify: true,
  breaks: true,
  highlight(code, language) {
    if (language && hljs.getLanguage(language)) {
      try {
        return hljs.highlight(code, { language, ignoreIllegals: true }).value;
      } catch {
        /* Markdown escapes unrecognized code. */
      }
    }
    return "";
  },
});
/** What a chat link needs on its element: a new tab, and a file hint before the click. */
function chatLinkAttributes(href: string, title?: string | null): Record<string, string> {
  const attributes: Record<string, string> = {
    target: "_blank",
    rel: "noopener noreferrer",
  };
  const link = parseChatLink(href);
  if (link.kind === "file") {
    attributes["data-chat-file"] = "";
    if (!title) {
      const range = link.line
        ? link.endLine
          ? `:${link.line}–${link.endLine}`
          : `:${link.line}${link.column ? `:${link.column}` : ""}`
        : "";
      attributes.title = range ? `Открыть ${link.path}${range}` : "Открыть файл в Projector";
    }
  }
  return attributes;
}

const defaultLink = markdown.renderer.rules.link_open;
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index]!;
  const title = token.attrGet("title");
  for (const [name, value] of Object.entries(
    chatLinkAttributes(
      String(token.attrGet("href") ?? ""),
      title === null || title === undefined ? undefined : String(title),
    ),
  ))
    token.attrSet(name, value);
  return defaultLink
    ? defaultLink(tokens, index, options, env, self)
    : self.renderToken(tokens, index, options);
};
markdown.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index]!;
  const alt = self.renderInlineAsText(token.children ?? [], options, env);
  const resolve = (env as MarkdownEnv | undefined)?.resolveImage;
  // An image the chat cannot load becomes its alt text: no broken icon and no literal `!`.
  if (resolve) {
    const source = resolve(String(token.attrGet("src") ?? ""));
    if (!source) return `<span class="md-image-text">${markdown.utils.escapeHtml(alt)}</span>`;
    token.attrSet("src", source);
  }
  token.attrSet("alt", alt);
  token.attrSet("loading", "lazy");
  token.attrSet("decoding", "async");
  token.attrSet("referrerpolicy", "no-referrer");
  token.attrSet("class", "md-image");
  return self.renderToken(tokens, index, options);
};
/**
 * Raw HTML never reaches the markdown renderer's rules, so its links and pictures are finished
 * on the sanitized DOM: the same new tab, file hint and safe image source as their markdown forms.
 */
function decorateHtml(root: HTMLElement, resolve?: (src: string) => string | undefined) {
  for (const anchor of root.querySelectorAll("a")) {
    for (const [name, value] of Object.entries(
      chatLinkAttributes(anchor.getAttribute("href") ?? "", anchor.getAttribute("title")),
    ))
      anchor.setAttribute(name, value);
  }
  for (const image of root.querySelectorAll("img")) {
    const alt = image.getAttribute("alt") ?? "";
    // A source set is a second address the chat resolver never saw.
    image.removeAttribute("srcset");
    if (resolve) {
      const source = resolve(image.getAttribute("src") ?? "");
      if (!source) {
        const fallback = image.ownerDocument.createElement("span");
        fallback.className = "md-image-text";
        fallback.textContent = alt || "Изображение";
        image.replaceWith(fallback);
        continue;
      }
      image.setAttribute("src", source);
    }
    image.setAttribute("alt", alt);
    image.setAttribute("loading", "lazy");
    image.setAttribute("decoding", "async");
    image.setAttribute("referrerpolicy", "no-referrer");
    image.setAttribute("class", "md-image");
  }
  for (const source of root.querySelectorAll("source[srcset]")) source.removeAttribute("srcset");
}

/** Markdown as HTML, not yet sanitized. */
export const renderMarkdown = (content: string, env: MarkdownEnv = {}): string =>
  markdown.render(content, env);
/** The block structure of `content`: the tokens, with the source lines each top-level block spans. */
export const parseMarkdown = (content: string) => markdown.parse(content, {});
export function renderChatMarkdown(content: string, env: MarkdownEnv = {}): string {
  const root = DOMPurify.sanitize(renderMarkdown(content, env), {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "loading", "decoding", "referrerpolicy", "class"],
    RETURN_DOM: true,
  }) as HTMLElement;
  decorateHtml(root, env.resolveImage);
  return root.innerHTML;
}
