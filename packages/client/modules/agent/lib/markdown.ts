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
  const token = tokens[index]!;
  token.attrSet("target", "_blank");
  token.attrSet("rel", "noopener noreferrer");
  // A file link's click is handled in the chat; the hint says so before the click.
  const link = parseChatLink(String(token.attrGet("href") ?? ""));
  if (link.kind === "file") {
    token.attrSet("data-chat-file", "");
    if (!token.attrGet("title")) {
      const range = link.line
        ? link.endLine
          ? `:${link.line}–${link.endLine}`
          : `:${link.line}${link.column ? `:${link.column}` : ""}`
        : "";
      token.attrSet("title", range ? `Открыть ${link.path}${range}` : "Открыть файл в Projector");
    }
  }
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
    ADD_ATTR: ["target", "loading", "decoding", "referrerpolicy", "class"],
  });
}
