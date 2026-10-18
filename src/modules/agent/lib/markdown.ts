import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";

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
}).disable("image");
const defaultLink = markdown.renderer.rules.link_open;
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index]!.attrSet("target", "_blank");
  tokens[index]!.attrSet("rel", "noopener noreferrer");
  return defaultLink
    ? defaultLink(tokens, index, options, env, self)
    : self.renderToken(tokens, index, options);
};
/** Markdown as HTML, not yet sanitized. */
export const renderMarkdown = (content: string): string => markdown.render(content);
/** The block structure of `content`: the tokens, with the source lines each top-level block spans. */
export const parseMarkdown = (content: string) => markdown.parse(content, {});
export function renderChatMarkdown(content: string): string {
  return DOMPurify.sanitize(renderMarkdown(content), { USE_PROFILES: { html: true } });
}
