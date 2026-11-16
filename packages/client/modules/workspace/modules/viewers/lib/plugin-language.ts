import { LanguageDescription, StreamLanguage, type StreamParser } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { tags as t, type Tag } from "@lezer/highlight";
import { findLanguage, type ActiveLanguage } from "../../../../plugin-runtime/index.ts";

const languageOf = (path: string) =>
  LanguageDescription.matchFilename(languages, path.split("/").at(-1) ?? path);

const tokenTable: Record<string, Tag> = {
  keyword: t.keyword,
  operatorKeyword: t.operatorKeyword,
  controlKeyword: t.controlKeyword,
  modifier: t.modifier,
  operator: t.operator,
  punctuation: t.punctuation,
  string: t.string,
  regexp: t.regexp,
  escape: t.escape,
  number: t.number,
  bool: t.bool,
  null: t.null,
  atom: t.atom,
  comment: t.comment,
  typeName: t.typeName,
  className: t.className,
  namespace: t.namespace,
  variableName: t.variableName,
  functionName: t.function(t.variableName),
  propertyName: t.propertyName,
  tagName: t.tagName,
  angleBracket: t.angleBracket,
  attributeName: t.attributeName,
  attributeValue: t.attributeValue,
  meta: t.meta,
  heading: t.heading,
  link: t.link,
};

/** A plugin grammar is data: the host builds the CodeMirror parser with its own instance. */
export function pluginLanguageExtension(
  languageEntry: ActiveLanguage,
): ReturnType<typeof StreamLanguage.define> {
  const parser: StreamParser<Record<string, never>> = {
    name: `plugin:${languageEntry.packageName}:${languageEntry.declaration.id}`,
    startState: () => ({}),
    token(stream) {
      if (stream.eol()) return null;
      for (const rule of languageEntry.rules) {
        const before = stream.pos;
        if (stream.match(rule.regex)) {
          if (stream.pos === before) stream.next();
          return rule.token ?? null;
        }
      }
      stream.next();
      return null;
    },
    tokenTable,
  };
  return StreamLanguage.define(parser);
}

/** Язык подсветки, определённый по имени файла, или `null`, если он неизвестен. */
export function languageLabel(path: string): string | null {
  const plugin = findLanguage(path);
  if (plugin) return plugin.declaration.title;
  return languageOf(path)?.name ?? null;
}

export function fallbackLanguageOf(path: string) {
  return languageOf(path);
}
