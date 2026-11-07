import { answerFormSource } from "./answer.ts";
import { autoClose, parseWidgetSource } from "./autoclose.ts";
import { compileScript, compileTemplate, loadCompiler } from "./compile.ts";
import { isWidgetName } from "./registry.ts";
import { splitMessage } from "./split.ts";

/** Nothing here executes the widget: valid template and script syntax is enough to show it. */
async function widgetProblem(source: string, empty: string): Promise<string | undefined> {
  await loadCompiler();
  const parsed = parseWidgetSource(source);
  if (parsed.scriptOpen) return "Незакрытый <script>";
  if (!parsed.template.trim()) return empty;
  const unknown = [...parsed.template.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)].find(
    ([, name]) => !isWidgetName(name!),
  );
  if (unknown) return `Неизвестный компонент ${unknown[1]}`;
  try {
    if (parsed.script) compileScript(parsed.script);
    compileTemplate(parsed.template);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function formProblem(source: string): Promise<string | undefined> {
  return widgetProblem(source, "Пустая форма");
}

const MARKDOWN_TEXT =
  /(^|\n)\s{0,3}(#{1,6}\s+\S|[-*+]\s+\S|\d+\.\s+\S)|\*\*[^*\n]+\*\*|`[^`\n]+`|(^|\n)\s*\|?\s*:?-{3,}/;

/** Markdown in a Vue slot is rendered literally instead of becoming formatted content. */
function widgetMarkdownProblem(source: string): string | undefined {
  const { template } = parseWidgetSource(source);
  const text = template.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, "\n");
  return MARKDOWN_TEXT.test(text)
    ? "Внутри виджета остался Markdown: он показывается как сломанный исходный текст"
    : undefined;
}

/** A finished answer is repaired only for visible structural problems, never just to rewrite it. */
export async function answerProblem(source: string): Promise<string | undefined> {
  const parts = splitMessage(source, { known: isWidgetName, streaming: false });
  for (const part of parts) {
    if (part.type === "widget") {
      const problem =
        (await widgetProblem(part.source, `Пустой виджет ${part.name}`)) ??
        widgetMarkdownProblem(part.source);
      if (problem) return `${part.name}: ${problem}`;
      continue;
    }
    if (part.type !== "markdown") continue;
    let fence = "";
    for (const line of part.text.split("\n")) {
      const mark = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (mark) {
        if (!fence) fence = mark;
        else if (mark[0] === fence[0] && mark.length >= fence.length) fence = "";
        continue;
      }
      const name = !fence && /^ {0,3}<([A-Z][A-Za-z0-9]*)(?=[\s/>]|$)/.exec(line)?.[1];
      if (name && isWidgetName(name)) return `Незакрытый или неверно оформленный виджет ${name}`;
    }
  }
  return undefined;
}

/** Accept a bare answer or one fenced block, but never an empty doctor response. */
export function doctorAnswerSource(text: string): string | undefined {
  const fenced = /^```(?:markdown|md|text|vue|html)?\s*\n?([\s\S]*?)\n?```$/i.exec(text.trim());
  const candidate = (fenced?.[1] ?? text).trim();
  return candidate || undefined;
}

/** End of a tag, skipping `>` inside quoted attribute values. */
function tagEnd(text: string, from: number): number {
  let quote = "";
  for (let at = from; at < text.length; at++) {
    const char = text[at]!;
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === ">") return at + 1;
  }
  return -1;
}

/** Drop repeated attributes from one opening tag, keeping the first one. */
function dedupeTag(tag: string): string {
  const name = /^<\s*([A-Za-z][\w-]*)/.exec(tag)?.[1];
  if (!name) return tag;
  const end = tag.length - 1;
  let at = tag.indexOf(name, 1) + name.length;
  let output = tag.slice(0, at);
  const seen = new Set<string>();
  while (at < end) {
    const gap = at;
    while (at < end && /\s/.test(tag[at]!)) at++;
    if (at >= end || tag[at] === "/") {
      output += tag.slice(gap);
      at = tag.length;
      break;
    }
    const start = at;
    while (at < end && !/[\s=/>]/.test(tag[at]!)) at++;
    const attribute = tag.slice(start, at);
    let stop = at;
    let after = at;
    while (after < end && /\s/.test(tag[after]!)) after++;
    if (tag[after] === "=") {
      after++;
      while (after < end && /\s/.test(tag[after]!)) after++;
      const quote = tag[after];
      if (quote === '"' || quote === "'" || quote === "`") {
        after++;
        while (after < end && tag[after] !== quote) after++;
        if (after < end) after++;
      } else {
        while (after < end && !/[\s>]/.test(tag[after]!)) after++;
      }
      stop = after;
    }
    if (!seen.has(attribute)) {
      seen.add(attribute);
      output += tag.slice(gap, stop);
    }
    at = stop;
  }
  return output + tag.slice(at);
}

/** Duplicate attributes are the common compiler error when a model repeats `name` or a binding. */
export function dedupeAttributes(text: string): string {
  let output = "";
  let at = 0;
  while (at < text.length) {
    const open = text.indexOf("<", at);
    if (open < 0) return output + text.slice(at);
    output += text.slice(at, open);
    if (text.startsWith("<!--", open)) {
      const close = text.indexOf("-->", open);
      if (close < 0) return output + text.slice(open);
      output += text.slice(open, close + 3);
      at = close + 3;
      continue;
    }
    const next = text[open + 1] ?? "";
    if (!/[A-Za-z]/.test(next)) {
      output += "<";
      at = open + 1;
      continue;
    }
    const end = tagEnd(text, open + 1);
    if (end < 0) return output + text.slice(open);
    output += dedupeTag(text.slice(open, end));
    at = end;
  }
  return output;
}

/**
 * Repair what can be repaired without a model: repeated attributes and incomplete closing tags.
 * The source is split first, so `<` inside a script or text is never treated as a tag.
 */
export function heuristicFormRepair(source: string): string {
  const parsed = parseWidgetSource(source);
  if (parsed.scriptOpen) return source;
  const template = autoClose(dedupeAttributes(parsed.template));
  if (!parsed.script) return template;
  return `<script>${parsed.script}</script>${template}`;
}

/** A doctor answer may be wrapped in prose or a fenced block; take the last answer-form block. */
export function doctorFormSource(text: string): string | undefined {
  const fenced = [...text.matchAll(/```(?:vue|html)?\s*([\s\S]*?)```/gi)].at(-1);
  const candidate = (fenced?.[1] ?? text).trim();
  if (!candidate) return undefined;
  const parts = splitMessage(candidate, { known: isWidgetName, streaming: false });
  const last = parts
    .filter((part) => part.type !== "script" && (part.type !== "markdown" || part.text.trim()))
    .at(-1);
  if (last?.type !== "widget") return undefined;
  return answerFormSource(candidate);
}
