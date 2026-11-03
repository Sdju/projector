import { os } from "../../../core/modules/os/index.ts";
import { realpath } from "node:fs/promises";
import { HttpError } from "../http/index.ts";
import { MAX_BYTES, excludePatterns } from "./paths.ts";
import { git } from "./git.ts";
import { resolveRevision } from "./git-tree.ts";
import {
  isExcludedPath,
  type SearchHit,
  type SearchMatch,
  type SearchOptions,
} from "../../../core/modules/workspace/index.ts";

export async function searchProject(root: string, query: string, options: SearchOptions = {}) {
  if (!query.trim()) return { hits: [], truncated: false };
  if (query.length > 200) throw new HttpError(400, "Запрос длиннее 200 символов");
  const base = await realpath(root);
  let output: string;
  try {
    const args = [
      "--json",
      "--hidden",
      "--no-require-git",
      "--max-count",
      "5",
      "--max-filesize",
      "1M",
    ];
    if (!options.regex) args.push("--fixed-strings");
    args.push(options.caseSensitive ? "--case-sensitive" : "--ignore-case");
    if (options.wholeWord) args.push("--word-regexp");
    for (const pattern of await excludePatterns()) {
      args.push("--glob", `!${pattern}`);
      if (!pattern.endsWith("/**")) args.push("--glob", `!${pattern}/**`);
    }
    args.push("--", query, ".");
    const result = await os.tools.searchFiles(args, {
      cwd: base,
      maxBuffer: 4 * MAX_BYTES,
      timeout: 10000,
    });
    output = result.stdout;
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string };
    if (failure.code === 1) return { hits: [], truncated: false };
    if (failure.code === "ENOENT") throw new HttpError(503, "Для поиска нужен ripgrep (rg)");
    throw new HttpError(400, "Поиск слишком большой или недоступен. Уточните запрос.");
  }
  const hits: SearchHit[] = [];
  for (const row of output.split("\n")) {
    if (!row) continue;
    const event = JSON.parse(row);
    if (event.type !== "match" || !event.data.path.text || !event.data.lines.text) continue;
    const data = event.data;
    const lineText = data.lines.text;
    const text = lineText.trimEnd().slice(0, 500);
    const charOffset = (byte: number) =>
      Buffer.from(lineText).subarray(0, byte).toString("utf8").length;
    const matches: SearchMatch[] = [];
    for (const submatch of data.submatches ?? []) {
      const start = charOffset(submatch.start);
      if (start >= text.length) continue;
      matches.push({ start, end: Math.min(charOffset(submatch.end), text.length) });
    }
    hits.push({
      path: (os.platform === "win32"
        ? data.path.text.replaceAll("\\", "/")
        : data.path.text
      ).replace(/^\.\//, ""),
      line: data.line_number,
      column: charOffset(data.submatches?.[0]?.start ?? 0) + 1,
      text,
      matches,
    });
    if (hits.length > 200) break;
  }
  return { hits: hits.slice(0, 200), truncated: hits.length > 200 };
}

function positions(text: string, query: string, options: SearchOptions) {
  const matches: SearchMatch[] = [];
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

/** Search a committed tree with `git grep`; paths stay relative to the project folder. */
export async function searchProjectGit(
  root: string,
  rev: string,
  query: string,
  options: SearchOptions = {},
) {
  if (!query.trim()) return { hits: [], truncated: false };
  if (query.length > 200) throw new HttpError(400, "Запрос длиннее 200 символов");
  const commit = await resolveRevision(root, rev);
  const args = ["grep", "-n", "-I", "-z", options.regex ? "-E" : "-F"];
  if (!options.caseSensitive) args.push("-i");
  if (options.wholeWord) args.push("-w");
  args.push("-e", query, commit, "--");
  let output: string;
  try {
    output = await git(root, args, 4 * MAX_BYTES);
  } catch (error) {
    const failure = error as { code?: number | string };
    if (failure.code === 1) return { hits: [], truncated: false };
    throw new HttpError(400, "Поиск по снимку недоступен. Уточните запрос.");
  }
  const patterns = await excludePatterns();
  const hits: SearchHit[] = [];
  for (const row of output.split("\n")) {
    if (!row) continue;
    const first = row.indexOf("\0");
    const second = row.indexOf("\0", first + 1);
    if (first < 0 || second < 0) continue;
    const location = row.slice(0, first);
    const line = Number(row.slice(first + 1, second));
    const colon = location.indexOf(":");
    if (colon < 0 || !Number.isSafeInteger(line) || line < 1) continue;
    const path = location.slice(colon + 1);
    if (!path || isExcludedPath(path, patterns)) continue;
    const text = row.slice(second + 1).slice(0, 500);
    const matches = positions(text, query, options);
    hits.push({
      path,
      line,
      column: (matches[0]?.start ?? 0) + 1,
      text,
      matches,
    });
    if (hits.length > 200) break;
  }
  return { hits: hits.slice(0, 200), truncated: hits.length > 200 };
}
