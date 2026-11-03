import type { SearchMatch, SearchOptions } from "./contract.ts";

/** Character offsets of one query in a line; shared by local and remote search adapters. */
export function searchMatches(
  text: string,
  query: string,
  options: SearchOptions = {},
): SearchMatch[] {
  const matches: SearchMatch[] = [];
  if (!query) return matches;
  if (options.regex) {
    const expression = new RegExp(query, options.caseSensitive ? "g" : "gi");
    for (const match of text.matchAll(expression)) {
      if (!match[0]) break;
      matches.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
      if (matches.length >= 20) break;
    }
    return matches;
  }
  const haystack = options.caseSensitive ? text : text.toLowerCase();
  const needle = options.caseSensitive ? query : query.toLowerCase();
  let offset = 0;
  while (offset <= haystack.length && matches.length < 20) {
    const start = haystack.indexOf(needle, offset);
    if (start < 0) break;
    matches.push({ start, end: start + needle.length });
    offset = start + Math.max(needle.length, 1);
  }
  return matches;
}
