import MarkdownIt, { type Env } from "markdown-it";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";

/** What a chat rendering needs to know beyond the text: where its images come from. */
export type MarkdownEnv = Env & {
  /** The URL an image is shown from; `undefined` renders its alt text instead of a broken icon. */
  resolveImage?: (src: string) => string | undefined;
};

const markdown = new MarkdownIt({
  html: false,
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
const defaultLink = markdown.renderer.rules.link_open;
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index]!.attrSet("target", "_blank");
  tokens[index]!.attrSet("rel", "noopener noreferrer");
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
/** Markdown as HTML, not yet sanitized. */
export const renderMarkdown = (content: string, env: MarkdownEnv = {}): string =>
  markdown.render(content, env);
/** The block structure of `content`: the tokens, with the source lines each top-level block spans. */
export const parseMarkdown = (content: string) => markdown.parse(content, {});
export function renderChatMarkdown(content: string, env: MarkdownEnv = {}): string {
  return DOMPurify.sanitize(renderMarkdown(content, env), {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["loading", "decoding", "referrerpolicy", "class"],
  });
}
