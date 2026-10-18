/** A message is markdown with block-level Vue components (`<PascalCase …>`) between its paragraphs. */
export type MessagePart =
  | { type: "markdown"; text: string }
  | { type: "widget"; name: string; source: string; complete: boolean };

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

const SCRIPT_END = "</script>";

/** A `<script>` that follows `from` after whitespace only: its end index, -1 while unclosed, 0 if there is none. */
function scriptAfter(text: string, from: number): number {
  const at = from + (/^\s*/.exec(text.slice(from))![0].length ?? 0);
  if (!text.startsWith("<script>", at)) return 0;
  const close = text.indexOf(SCRIPT_END, at);
  return close < 0 ? -1 : close + SCRIPT_END.length;
}

/**
 * Splits at line starts outside code fences. Append-only text gives append-only parts: finished
 * parts keep their source, so callers can cache by it. An unfinished component is the last part
 * (`complete: false`); once streaming is over it falls back to plain markdown. A `<script>` directly
 * before or after a component belongs to it, because models put the setup on either side.
 */
export function splitMessage(
  text: string,
  options: { known?: (name: string) => boolean; streaming?: boolean } = {},
): MessagePart[] {
  const parts: MessagePart[] = [];
  const known = (name: string) => !options.known || options.known(name);
  let markdownFrom = 0;
  let fence = "";
  let offset = 0;
  const flush = (to: number) => {
    const chunk = text.slice(markdownFrom, to);
    if (chunk.trim()) parts.push({ type: "markdown", text: chunk });
  };
  /** Takes `text[lineStart…end)` as a component part, or all the rest as an unfinished one. */
  const take = (lineStart: number, start: number, name: string, end: number) => {
    flush(lineStart);
    const complete = end >= 0;
    parts.push({
      type: "widget",
      name,
      source: text.slice(start, complete ? end : undefined),
      complete,
    });
    return complete;
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
      if (name && known(name)) {
        let end = widgetEnd(text, start, name);
        if (end >= 0) {
          const script = scriptAfter(text, end);
          if (script > 0) end = script;
          else if (script < 0 && options.streaming) end = -1;
        }
        if (end >= 0 || options.streaming) {
          if (!take(offset, start, name, end)) return parts;
          markdownFrom = offset = end;
          continue;
        }
      } else if (SCRIPT_LINE.test(line)) {
        const scriptEnd = scriptAfter(text, start);
        const after =
          scriptEnd > 0 ? scriptEnd + /^\s*/.exec(text.slice(scriptEnd))![0].length : -1;
        const widget = after >= 0 ? OPEN_LINE.exec(text.slice(after, after + 80))?.[1] : undefined;
        if (scriptEnd < 0 || (scriptEnd > 0 && after === text.length)) {
          if (options.streaming) {
            take(offset, start, "script", -1);
            return parts;
          }
        } else if (widget && known(widget)) {
          const end = widgetEnd(text, after, widget);
          if (end >= 0 || options.streaming) {
            if (!take(offset, start, widget, end)) return parts;
            markdownFrom = offset = end;
            continue;
          }
        }
      }
    }
    offset = next;
  }
  flush(text.length);
  return parts;
}
