/** A message is markdown with block-level Vue components (`<PascalCase …>`) between its paragraphs. */
export type MessagePart =
  | { type: "markdown"; text: string }
  | { type: "widget"; name: string; source: string; complete: boolean }
  /** A `<script>` outside any component: values shared by every component of the message. */
  | { type: "script"; source: string; complete: boolean };

const OPEN_LINE = /^ {0,3}<([A-Z][A-Za-z0-9]*)(?=[\s/>]|$)/;
const SCRIPT_LINE = /^ {0,3}<script>/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** End of an opening tag (index after `>`), skipping `>` inside quoted values; -1 while unfinished. */
function tagEnd(text: string, from: number): number {
  let quote = "";
  for (let i = from; i < text.length; i++) {
    const char = text[i]!;
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === ">") return i + 1;
  }
  return -1;
}

/** End of the component starting at `start`, balancing nested tags of the same name; -1 if unclosed. */
function widgetEnd(text: string, start: number, name: string): number {
  const open = `<${name}`;
  const close = `</${name}`;
  let depth = 0;
  let at = start;
  while (at < text.length) {
    const next = text.indexOf("<", at);
    if (next < 0) return -1;
    if (
      text.startsWith(close, next) &&
      /^\s*>/.test(text.slice(next + close.length, next + close.length + 8))
    ) {
      const end = text.indexOf(">", next);
      if (end < 0) return -1;
      if (--depth === 0) return end + 1;
      at = end + 1;
    } else if (text.startsWith(open, next) && /[\s/>]/.test(text[next + open.length] ?? "")) {
      const end = tagEnd(text, next + open.length);
      if (end < 0) return -1;
      if (text[end - 2] !== "/") depth++;
      else if (depth === 0) return end;
      at = end;
    } else at = next + 1;
  }
  return -1;
}

const SCRIPT_START = "<script>";
const SCRIPT_END = "</script>";

/**
 * Splits at line starts outside code fences. Append-only text gives append-only parts: finished
 * parts keep their source, so callers can cache by it. An unfinished component or script is the
 * last part (`complete: false`); once streaming is over it falls back to plain markdown. A
 * `<script>` inside a component is that component's; one between blocks is shared by the message.
 */
export function splitMessage(
  text: string,
  options: { known?: (name: string) => boolean; streaming?: boolean } = {},
): MessagePart[] {
  const parts: MessagePart[] = [];
  let markdownFrom = 0;
  let fence = "";
  let offset = 0;
  const flush = (to: number) => {
    const chunk = text.slice(markdownFrom, to);
    if (chunk.trim()) parts.push({ type: "markdown", text: chunk });
  };
  while (offset < text.length) {
    const lineEnd = text.indexOf("\n", offset);
    const next = lineEnd < 0 ? text.length : lineEnd + 1;
    const line = text.slice(offset, next);
    const mark = FENCE.exec(line)?.[1];
    if (fence) {
      if (mark && mark[0] === fence[0] && mark.length >= fence.length) fence = "";
    } else if (mark) fence = mark;
    else {
      const start = offset + line.indexOf("<");
      const name = OPEN_LINE.exec(line)?.[1];
      if (name && (!options.known || options.known(name))) {
        const end = widgetEnd(text, start, name);
        if (end >= 0 || options.streaming) {
          flush(offset);
          parts.push({
            type: "widget",
            name,
            source: text.slice(start, end >= 0 ? end : undefined),
            complete: end >= 0,
          });
          if (end < 0) return parts;
          markdownFrom = offset = end;
          continue;
        }
      } else if (SCRIPT_LINE.test(line)) {
        const close = text.indexOf(SCRIPT_END, start);
        if (close >= 0 || options.streaming) {
          flush(offset);
          parts.push({
            type: "script",
            source: text.slice(start + SCRIPT_START.length, close >= 0 ? close : undefined),
            complete: close >= 0,
          });
          if (close < 0) return parts;
          markdownFrom = offset = close + SCRIPT_END.length;
          continue;
        }
      }
    }
    offset = next;
  }
  flush(text.length);
  return parts;
}
