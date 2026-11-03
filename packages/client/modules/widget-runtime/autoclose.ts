/** Splits a component source into its template and its `<script>`, which is not part of the template. */
export interface WidgetSource {
  template: string;
  script?: string;
  /** A `<script>` has started but is not closed yet: its code cannot run. */
  scriptOpen: boolean;
}

const SCRIPT_START = "<script>";
const SCRIPT_END = "</script>";

export function parseWidgetSource(source: string): WidgetSource {
  const start = source.indexOf(SCRIPT_START);
  if (start < 0) return { template: source, scriptOpen: false };
  const end = source.indexOf(SCRIPT_END, start);
  if (end < 0) return { template: source.slice(0, start), scriptOpen: true };
  return {
    template: source.slice(0, start) + source.slice(end + SCRIPT_END.length),
    script: source.slice(start + SCRIPT_START.length, end),
    scriptOpen: false,
  };
}

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

/** End of an opening tag (index after `>`), skipping `>` inside quoted values; -1 while unfinished. */
function tagEnd(text: string, from: number): number {
  let quote = "";
  for (let i = from; i < text.length; i++) {
    const char = text[i]!;
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === ">") return i + 1;
  }
  return -1;
}

/**
 * Makes a half-written template compile: whatever is unfinished at the end (a tag still being typed,
 * an open `{{`, a comment) is dropped, and every element still open is closed. Streaming then grows
 * the same tree element by element instead of waiting for the last closing tag.
 */
export function autoClose(text: string): string {
  const stack: string[] = [];
  let cut = text.length;
  let at = 0;
  scan: while (at < text.length) {
    const lt = text.indexOf("<", at);
    const interpolation = text.indexOf("{{", at);
    if (interpolation >= 0 && (lt < 0 || interpolation < lt)) {
      const close = text.indexOf("}}", interpolation);
      if (close < 0) {
        cut = interpolation;
        break;
      }
      at = close + 2;
      continue;
    }
    if (lt < 0) break;
    const rest = text.slice(lt, lt + 4);
    if (rest.startsWith("<!--")) {
      const close = text.indexOf("-->", lt);
      if (close < 0) {
        cut = lt;
        break;
      }
      at = close + 3;
    } else if (rest.startsWith("</")) {
      const end = text.indexOf(">", lt);
      if (end < 0) {
        cut = lt;
        break;
      }
      const name = /^<\/\s*([A-Za-z][\w-]*)/.exec(text.slice(lt, end))?.[1];
      const index = name ? stack.lastIndexOf(name) : -1;
      if (index >= 0) stack.length = index;
      at = end + 1;
    } else if (/^<[A-Za-z]/.test(rest)) {
      const name = /^<([A-Za-z][\w-]*)/.exec(text.slice(lt))![1]!;
      const end = tagEnd(text, lt + 1 + name.length);
      if (end < 0) {
        cut = lt;
        break;
      }
      if (name === "script" || name === "style") {
        const closeTag = text.indexOf(`</${name}>`, end);
        if (closeTag < 0) {
          cut = lt;
          break scan;
        }
        at = closeTag + name.length + 3;
        continue;
      }
      if (text[end - 2] !== "/" && !VOID.has(name.toLowerCase())) stack.push(name);
      at = end;
    } else if (lt === text.length - 1) {
      cut = lt;
      break;
    } else at = lt + 1;
  }
  return (
    text.slice(0, cut) +
    stack
      .reverse()
      .map((name) => `</${name}>`)
      .join("")
  );
}
