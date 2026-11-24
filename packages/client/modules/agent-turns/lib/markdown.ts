import { parseChatLink } from "../../agent-core/index.ts";
import {
  parseMarkdown,
  renderMarkdown as renderDisplayMarkdown,
  renderSafeMarkdown,
  type MarkdownEnv,
} from "../../markdown/index.ts";

export type { MarkdownEnv };
export { parseMarkdown };

/** What a chat link needs on its element: a new tab, and a file hint before the click. */
function chatLinkAttributes(href: string, title?: string | null): Record<string, string> {
  const attributes: Record<string, string> = {
    target: "_blank",
    rel: "noopener noreferrer",
  };
  const link = parseChatLink(href);
  if (link.kind === "file") {
    // The sanitizer drops an `href` whose scheme it does not know (a Windows drive letter or
    // `file:`), so the original target also lives in a data attribute the click handler reads.
    attributes["data-chat-file"] = link.href;
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

function withChat(env: MarkdownEnv = {}): MarkdownEnv {
  return { ...env, linkAttributes: chatLinkAttributes, allowFileLinks: true };
}

/** Markdown as HTML, not yet sanitized. Chat file links are marked for the click handler. */
export const renderMarkdown = (content: string, env: MarkdownEnv = {}): string =>
  renderDisplayMarkdown(content, withChat(env));

export function renderChatMarkdown(content: string, env: MarkdownEnv = {}): string {
  return renderSafeMarkdown(content, withChat(env));
}
