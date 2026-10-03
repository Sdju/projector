import { os } from "../../../core/modules/os/index.ts";
import { realpath } from "node:fs/promises";
import { HttpError } from "../http/index.ts";
import { MAX_BYTES, excluded } from "./paths.ts";
import type {
  SearchHit,
  SearchMatch,
  SearchOptions,
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
    args.push(...[...excluded].flatMap((name) => ["--glob", `!${name}/**`]), "--", query, ".");
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
      path: data.path.text.replace(/^\.\//, ""),
      line: data.line_number,
      column: charOffset(data.submatches?.[0]?.start ?? 0) + 1,
      text,
      matches,
    });
    if (hits.length > 200) break;
  }
  return { hits: hits.slice(0, 200), truncated: hits.length > 200 };
}
