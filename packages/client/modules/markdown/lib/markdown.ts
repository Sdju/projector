import MarkdownIt, { type Env } from "markdown-it";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";

/** Extra rendering context: image URLs and how links are annotated. */
export type MarkdownEnv = Env & {
  /** The URL an image is shown from; `undefined` renders its alt text instead of a broken icon. */
  resolveImage?: (src: string) => string | undefined;
  /** Extra attributes for a link; defaults to a new-tab web link, and drops in-app relative hrefs. */
  linkAttributes?: (href: string, title?: string | null) => Record<string, string>;
  /**
   * Chat turns a single newline into `<br>`; a README keeps CommonMark paragraphs.
   * Default is `true` so the chat stream stays as it was.
   */
  breaks?: boolean;
  /**
   * Parse `file:` destinations as links. Markdown-it blocks them by default; the chat enables
   * them because agents (Antigravity) link local files that way, and the click handler opens them.
   */
  allowFileLinks?: boolean;
};

/** External addresses open in a new tab; a relative path must not navigate the host page. */
export function webLinkAttributes(href: string): Record<string, string> {
  if (!href || href.startsWith("#")) return {};
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href))
    return { target: "_blank", rel: "noopener noreferrer" };
  return { href: "" };
}

const markdown = new MarkdownIt({
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

/** Markdown-it's own guard: `file:` is refused so `[file](file:///…)` stays literal text. */
const defaultValidateLink = markdown.validateLink.bind(markdown);
const withFileLinks = (url: string) =>
  url.trim().toLowerCase().startsWith("file:") || defaultValidateLink(url);

function applyLinkAttributes(
  href: string,
  title: string | null | undefined,
  env: MarkdownEnv | undefined,
  set: (name: string, value: string) => void,
  unset: (name: string) => void,
) {
  const attributes = (env?.linkAttributes ?? webLinkAttributes)(href, title);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === "href" && !value) unset("href");
    else set(name, value);
  }
}

const defaultFence = markdown.renderer.rules.fence;
markdown.renderer.rules.fence = (tokens, index, options, env, self) => {
  const token = tokens[index]!;
  if (token.info.trim().toLowerCase() === "mermaid")
    return `<div class="md-mermaid">${markdown.utils.escapeHtml(token.content)}</div>`;
  return defaultFence
    ? defaultFence(tokens, index, options, env, self)
    : self.renderToken(tokens, index, options);
};

const defaultLink = markdown.renderer.rules.link_open;
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index]!;
  const title = token.attrGet("title");
  applyLinkAttributes(
    String(token.attrGet("href") ?? ""),
    title === null || title === undefined ? undefined : String(title),
    env as MarkdownEnv,
    (name, value) => token.attrSet(name, value),
    (name) => {
      const i = token.attrIndex(name);
      if (i >= 0) token.attrs?.splice(i, 1);
    },
  );
  return defaultLink
    ? defaultLink(tokens, index, options, env, self)
    : self.renderToken(tokens, index, options);
};

markdown.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index]!;
  const alt = self.renderInlineAsText(token.children ?? [], options, env);
  const resolve = (env as MarkdownEnv | undefined)?.resolveImage;
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

function decorateHtml(root: HTMLElement, env: MarkdownEnv) {
  for (const anchor of root.querySelectorAll("a")) {
    applyLinkAttributes(
      anchor.getAttribute("href") ?? "",
      anchor.getAttribute("title"),
      env,
      (name, value) => anchor.setAttribute(name, value),
      (name) => anchor.removeAttribute(name),
    );
  }
  for (const image of root.querySelectorAll("img")) {
    const alt = image.getAttribute("alt") ?? "";
    image.removeAttribute("srcset");
    if (env.resolveImage) {
      const source = env.resolveImage(image.getAttribute("src") ?? "");
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

function applyEnv(env: MarkdownEnv) {
  markdown.set({ breaks: env.breaks !== false });
  markdown.validateLink = env.allowFileLinks ? withFileLinks : defaultValidateLink;
}

/** Markdown as HTML, not yet sanitized. */
export const renderMarkdown = (content: string, env: MarkdownEnv = {}): string => {
  applyEnv(env);
  return markdown.render(content, env);
};

/** The block structure of `content`: the tokens, with the source lines each top-level block spans. */
export const parseMarkdown = (content: string, env: MarkdownEnv = {}) => {
  applyEnv(env);
  return markdown.parse(content, env);
};

/** Sanitized HTML for a page: DOMPurify decides what reaches the document. */
export function renderSafeMarkdown(content: string, env: MarkdownEnv = {}): string {
  const root = DOMPurify.sanitize(renderMarkdown(content, env), {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "loading", "decoding", "referrerpolicy", "class", "data-mermaid-source"],
    RETURN_DOM: true,
  }) as HTMLElement;
  decorateHtml(root, env);
  return root.innerHTML;
}
