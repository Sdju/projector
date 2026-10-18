import { expect, test } from "vite-plus/test";
import { renderMarkdown } from "../src/modules/agent/lib/markdown.ts";
import { createMarkdownStream } from "../src/modules/agent/lib/markdown-stream.ts";

const code = Array.from({ length: 6 }, (_, i) => `  const v${i} = await load(${i});`).join("\n");
const documents = {
  answer: `## Шаг\n\nПроверил \`server/history.ts\` и нашёл **расхождение**.\n\n- один\n- два с \`кодом\`\n\n\`\`\`ts\nasync function run() {\n${code}\n}\n\`\`\`\n\nИтог.`,
  loose: "- a\n\n  continued\n\n- b\n- c\n\nafter the list\n\n1. one\n2. two\n\n10. ten",
  quote: "> quote line one\ncontinues lazily\n\n> second\n>\n> third\n\nplain",
  setext: "Title\n=====\n\nSub\n---\n\npara\ntwo lines\n\n---\n\nend",
  table: "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\ntext after\n\n| x |\n|---|\n| y |",
  fences: "~~~\ntilde ``` inside\n~~~\n\n````md\n```js\nnested\n```\n````\n\ntail",
  indented: "para\n\n    indented code\n    more\n\nnext para\n\n    again code",
  entities:
    "a < b && c > d &amp; <b>raw</b>\n\n![img](x.png) and https://example.com/path.\n\nline\nbreak",
  headings: "# one\n## two\n### three\ntext right after\n\n#### four\n\n* * *\n\nlast",
  references: "see [the doc][ref] here\n\nmiddle\n\n[ref]: https://example.com\n\nend [ref]",
  empty: "\n\n\n",
};

/** Cuts a text into chunks of the given sizes, repeating. */
function* chunks(text, sizes) {
  for (let at = 0, i = 0; at < text.length; i++) {
    const size = sizes[i % sizes.length];
    yield text.slice(0, at + size);
    at += size;
  }
  yield text;
}

test("streaming a message block by block gives what rendering it whole gives", () => {
  for (const [name, text] of Object.entries(documents))
    for (const sizes of [[1], [3, 1, 7], [40]]) {
      const stream = createMarkdownStream(renderMarkdown);
      for (const prefix of chunks(text, sizes)) {
        const html = stream
          .update(prefix)
          .map((block) => block.html)
          .join("");
        expect(html, `${name} at ${prefix.length} of ${text.length} (${sizes})`).toBe(
          renderMarkdown(prefix),
        );
      }
    }
});

test("closed blocks are rendered once; only the open one is redone", () => {
  const rendered = [];
  const stream = createMarkdownStream((markdown) => {
    rendered.push(markdown);
    return renderMarkdown(markdown);
  });
  const paragraphs = Array.from({ length: 30 }, (_, i) => `Paragraph number ${i}.`).join("\n\n");
  for (const prefix of chunks(paragraphs, [5])) stream.update(prefix);
  // Re-rendering the whole text with every chunk would render about 40 thousand characters.
  const total = rendered.reduce((sum, markdown) => sum + markdown.length, 0);
  expect(total).toBeLessThan(paragraphs.length * 5);
  // A closed paragraph is rendered once, not once per chunk.
  expect(rendered.filter((markdown) => markdown.includes("Paragraph number 3.")).length).toBe(1);
});

test("a text that is not a continuation starts over", () => {
  const stream = createMarkdownStream(renderMarkdown);
  stream.update("first\n\nsecond\n\nthird");
  const html = stream.update("other\n\ntext");
  expect(html.map((block) => block.html).join("")).toBe(renderMarkdown("other\n\ntext"));
});

test("random markdown streams the same as it renders whole", () => {
  const lines = [
    "",
    "",
    "",
    "text line",
    "another line of text",
    "# heading",
    "## sub",
    "- item",
    "- item two",
    "  - nested",
    "1. first",
    "2. second",
    "10. ten",
    "> quote",
    "> > deep",
    "    indented",
    "\tcode",
    "```",
    "```js",
    "~~~",
    "---",
    "***",
    "===",
    "| a | b |",
    "|---|---|",
    "| 1 | 2 |",
    "**bold** and `code`",
    "<div>html</div>",
    "continued lazily",
    "  indented text",
    "[link](http://x.y)",
    "1) paren",
    "+ plus",
  ];
  let seed = 12345;
  const random = (n) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
  for (let round = 0; round < 250; round++) {
    const text = Array.from({ length: 4 + random(14) }, () => lines[random(lines.length)]).join(
      "\n",
    );
    const stream = createMarkdownStream(renderMarkdown);
    for (let at = 1; at <= text.length; at += 1 + random(9)) {
      const prefix = text.slice(0, at);
      const html = stream
        .update(prefix)
        .map((block) => block.html)
        .join("");
      expect(html, JSON.stringify(prefix)).toBe(renderMarkdown(prefix));
    }
    const html = stream
      .update(text)
      .map((block) => block.html)
      .join("");
    expect(html, JSON.stringify(text)).toBe(renderMarkdown(text));
  }
});
