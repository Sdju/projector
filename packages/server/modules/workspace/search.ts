import { os } from "@ai-projector/core/modules/os/index.ts";
import { realpath } from "node:fs/promises";
import { HttpError } from "../http/index.ts";
import { MAX_BYTES, excludePatterns } from "./paths.ts";
import { git, gitText } from "./git.ts";
import { resolveRevision } from "./git-tree.ts";
import {
  isExcludedPath,
  SEARCH_QUERY_MAX,
  searchMatches,
  type SearchHit,
  type SearchMatch,
  type SearchOptions,
} from "@ai-projector/core/modules/workspace/index.ts";

const multiline = (query: string) => query.includes("\n");

function wordMatches(text: string, query: string, options: SearchOptions) {
  const matches = searchMatches(text, query, options);
  if (!options.wholeWord) return matches;
  return matches.filter((match) => {
    const before = text[match.start - 1] ?? "";
    const after = text[match.end] ?? "";
    return !/\w/.test(before) && !/\w/.test(after);
  });
}

function hitsInBlob(path: string, content: string, query: string, options: SearchOptions) {
  const hits: SearchHit[] = [];
  for (const match of wordMatches(content, query, options).slice(0, 5)) {
    const prefix = content.slice(0, match.start);
    const lineStart = prefix.lastIndexOf("\n") + 1;
    const lineEnd = content.indexOf("\n", match.end);
    const text = content.slice(lineStart, lineEnd < 0 ? content.length : lineEnd).slice(0, 500);
    hits.push({
      path,
      line: prefix.split("\n").length,
      column: match.start - lineStart + 1,
      text,
      matches: [
        { start: match.start - lineStart, end: Math.min(match.end - lineStart, text.length) },
      ],
    });
  }
  return hits;
}

async function grepCommit(
  root: string,
  commit: string,
  query: string,
  options: SearchOptions,
  extra: string[],
) {
  const args = ["grep", ...extra, options.regex ? "-E" : "-F"];
  if (!options.caseSensitive) args.push("-i");
  if (options.wholeWord) args.push("-w");
  args.push("-e", query, commit, "--");
  try {
    return await git(root, args, 4 * MAX_BYTES);
  } catch (error) {
    const failure = error as { code?: number | string };
    if (failure.code === 1) return "";
    throw new HttpError(400, "Поиск по снимку недоступен. Уточните запрос.");
  }
}

export async function searchProject(root: string, query: string, options: SearchOptions = {}) {
  if (!query.trim()) return { hits: [], truncated: false };
  if (query.length > SEARCH_QUERY_MAX)
    throw new HttpError(400, `Запрос длиннее ${SEARCH_QUERY_MAX} символов`);
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
    if (multiline(query)) {
      args.push("--multiline");
      if (options.regex) args.push("--multiline-dotall");
    }
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

/** Search a committed tree with `git grep`; paths stay relative to the project folder. */
export async function searchProjectGit(
  root: string,
  rev: string,
  query: string,
  options: SearchOptions = {},
) {
  if (!query.trim()) return { hits: [], truncated: false };
  if (query.length > SEARCH_QUERY_MAX)
    throw new HttpError(400, `Запрос длиннее ${SEARCH_QUERY_MAX} символов`);
  const commit = await resolveRevision(root, rev);
  if (multiline(query)) {
    if (options.regex)
      throw new HttpError(400, "Многострочное регулярное выражение в снимке не поддерживается");
    const locator = query.split("\n").find((line) => line.length > 0);
    if (!locator) return { hits: [], truncated: false };
    const listed = await grepCommit(root, commit, locator, { ...options, regex: false }, [
      "-l",
      "-I",
      "-z",
    ]);
    if (!listed) return { hits: [], truncated: false };
    const patterns = await excludePatterns();
    const hits: SearchHit[] = [];
    let files = 0;
    for (const row of listed.split("\0")) {
      const colon = row.indexOf(":");
      const path = colon < 0 ? "" : row.slice(colon + 1);
      if (!path || isExcludedPath(path, patterns)) continue;
      files += 1;
      if (files > 80) return { hits: hits.slice(0, 200), truncated: true };
      try {
        hits.push(...hitsInBlob(path, await gitText(root, commit, path), query, options));
      } catch {
        continue;
      }
      if (hits.length > 200) break;
    }
    return { hits: hits.slice(0, 200), truncated: hits.length > 200 };
  }
  const output = await grepCommit(root, commit, query, options, ["-n", "-I", "-z"]);
  if (!output) return { hits: [], truncated: false };
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
    const matches = searchMatches(text, query, options);
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
