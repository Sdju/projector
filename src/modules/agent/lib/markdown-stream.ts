import { parseMarkdown, renderChatMarkdown } from "./markdown.ts";

export interface MarkdownBlock {
  key: number;
  html: string;
}

/** A link reference defined in the text can be used by any block: such a text is not split. */
const REFERENCE = /^ {0,3}\[[^\]\n]+\]:\s*\S/m;

/** Blocks that go on across blank lines: what follows may still become part of them. */
const CONTINUES = new Set(["bullet_list_open", "ordered_list_open", "code_block"]);

/**
 * Renders growing markdown block by block. A block followed by another one is closed for good, so
 * it is rendered once and only the open last block is parsed and rendered again with each chunk:
 * the cost of a chunk follows the size of that block, not of the whole message.
 */
export function createMarkdownStream(render: (markdown: string) => string = renderChatMarkdown) {
  let closed: MarkdownBlock[] = [];
  /** The text the closed blocks were rendered from. */
  let closedText = "";

  function reset() {
    closed = [];
    closedText = "";
  }

  return {
    update(text: string): MarkdownBlock[] {
      const split = !REFERENCE.test(text);
      if (!split || !text.startsWith(closedText)) reset();
      const tail = text.slice(closedText.length);
      // Offsets of the lines of the tail, to cut it where the blocks start.
      const lines = [0];
      for (let at = tail.indexOf("\n"); at >= 0; at = tail.indexOf("\n", at + 1))
        lines.push(at + 1);
      const blocks = split
        ? parseMarkdown(tail)
            .filter((token) => token.level === 0 && token.map && token.nesting >= 0)
            .map((token) => ({ start: token.map![0], continues: CONTINUES.has(token.type) }))
        : [];
      // The next block may still turn out to belong to a list or an indented code before it.
      const count = blocks.at(-2)?.continues ? blocks.length - 2 : blocks.length - 1;
      if (count > 0) {
        const open = lines[blocks[count]!.start]!;
        for (let index = 0; index < count; index++) {
          const from = index === 0 ? 0 : lines[blocks[index]!.start]!;
          const segment = tail.slice(from, lines[blocks[index + 1]!.start]!);
          closed.push({ key: closed.length, html: render(segment) });
        }
        closedText += tail.slice(0, open);
        return [...closed, { key: closed.length, html: render(tail.slice(open)) }];
      }
      return [...closed, { key: closed.length, html: render(tail) }];
    },
  };
}
