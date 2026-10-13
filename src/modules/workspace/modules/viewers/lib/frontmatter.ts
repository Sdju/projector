export interface FrontmatterEntry {
  key: string;
  value: string;
  /** Исходное значение было в кавычках: после правки остаётся в них. */
  quoted: boolean;
  /** Строки блока `[start, end)` внутри `raw.split(eol)`. */
  start: number;
  end: number;
}

export interface Frontmatter {
  /** Исходный блок вместе с разделителями и переводом строки: возвращается в файл как есть. */
  raw: string;
  entries: FrontmatterEntry[];
}

const BLOCK = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;
const KEY_LINE = /^([^\s#:][^:]*?)\s*:(?:\s+(.*))?$/;
const KEY_NAME = /^[\p{L}\p{N}_.-]+$/u;
const PLAIN = /^[^\s'"#&*!|>%@`[\]{},:?-]([^#]|(?<!\s)#)*$/;

function unquote(value: string) {
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.length > 1 && value.endsWith(quote))
    return { text: value.slice(1, -1), quoted: true };
  return { text: value, quoted: false };
}

function lineBounds(lines: string[]) {
  let close = lines.length - 1;
  while (close > 0 && !/^(---|\.\.\.)[ \t]*$/.test(lines[close]!)) close--;
  return { open: 1, close };
}

/** Плоское представление верхнего уровня YAML: вложенные значения остаются текстом. */
function parseEntries(lines: string[], from: number, to: number): FrontmatterEntry[] {
  const entries: FrontmatterEntry[] = [];
  for (let index = from; index < to; index++) {
    const line = lines[index]!;
    const match = KEY_LINE.exec(line);
    if (match) {
      const { text, quoted } = unquote((match[2] ?? "").trim());
      entries.push({ key: match[1]!, value: text, quoted, start: index, end: index + 1 });
      continue;
    }
    const last = entries.at(-1);
    if (!last || !line.trim() || line.trimStart().startsWith("#")) continue;
    last.value = `${last.value}${last.value ? "\n" : ""}${line.trim()}`;
    last.end = index + 1;
  }
  for (const entry of entries) entry.value = entry.value.replace(/^[|>][+-]?\n?/, "");
  return entries;
}

/** Отделяет YAML-блок в начале документа; без него `frontmatter` пуст, а `body` равен тексту. */
export function splitFrontmatter(content: string): { frontmatter?: Frontmatter; body: string } {
  const match = BLOCK.exec(content);
  if (!match) return { body: content };
  return { frontmatter: parseFrontmatter(match[0]), body: content.slice(match[0].length) };
}

export function parseFrontmatter(raw: string): Frontmatter {
  const lines = raw.split(/\r?\n/);
  const { open, close } = lineBounds(lines);
  return { raw, entries: parseEntries(lines, open, close) };
}

function serialize(key: string, value: string, quoted: boolean, indent = "  ") {
  if (!value) return [`${key}:`];
  if (value.includes("\n"))
    return [`${key}: |-`, ...value.split("\n").map((line) => (line ? indent + line : ""))];
  if (quoted || !PLAIN.test(value) || /:\s|:$|\s$/.test(value))
    return [`${key}: ${JSON.stringify(value)}`];
  return [`${key}: ${value}`];
}

function rewrite(frontmatter: Frontmatter, edit: (lines: string[], close: number) => void) {
  const eol = frontmatter.raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = frontmatter.raw.split(/\r?\n/);
  edit(lines, lineBounds(lines).close);
  return lines.join(eol);
}

export function setFrontmatterValue(frontmatter: Frontmatter, index: number, value: string) {
  const entry = frontmatter.entries[index];
  if (!entry || entry.value === value) return frontmatter.raw;
  return rewrite(frontmatter, (lines) =>
    lines.splice(
      entry.start,
      entry.end - entry.start,
      ...serialize(entry.key, value, entry.quoted),
    ),
  );
}

export function removeFrontmatterEntry(frontmatter: Frontmatter, index: number) {
  const entry = frontmatter.entries[index];
  if (!entry) return frontmatter.raw;
  return rewrite(frontmatter, (lines) => lines.splice(entry.start, entry.end - entry.start));
}

/** `undefined` — ключ недопустим или уже есть. */
export function addFrontmatterEntry(frontmatter: Frontmatter, key: string) {
  if (!KEY_NAME.test(key) || frontmatter.entries.some((entry) => entry.key === key)) return;
  return rewrite(frontmatter, (lines, close) => lines.splice(close, 0, `${key}:`));
}
