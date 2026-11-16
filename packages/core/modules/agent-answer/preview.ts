import { splitMessage } from "./split.ts";

const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;

/** Code is not a summary: fenced blocks are dropped without touching the text around them. */
function stripFencedCode(text: string): string {
  const kept: string[] = [];
  let fence = "";
  for (const line of text.split("\n")) {
    const mark = FENCE_LINE.exec(line)?.[1];
    if (fence) {
      if (mark && mark[0] === fence[0] && mark.length >= fence.length) fence = "";
      continue;
    }
    if (mark) {
      fence = mark;
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

/**
 * The readable part of an agent answer for notifications and inbox rows. Widgets are rendered by
 * the chat, but a notification can only show text: their markup, scripts and code blocks are
 * dropped, and the remaining markdown is flattened to one line. Plain answers pass through.
 */
export function answerPreview(text: string, limit = 300): string {
  const prose = splitMessage(text, { streaming: true })
    .filter((part) => part.type === "markdown")
    .map((part) => part.text)
    .join("\n");
  return stripFencedCode(prose)
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, "$1")
    .replace(/<\/?[A-Za-z][^>]*>/g, " ")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, "$1$2")
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit)
    .trim();
}
