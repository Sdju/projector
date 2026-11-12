import { HttpError } from "../http/index.ts";
import {
  SEARCH_QUERY_MAX,
  searchMatches,
  type SearchHit,
  type SearchMatch,
  type SearchOptions,
} from "@ai-projector/core/modules/workspace/index.ts";
import { gitlabReader } from "./api.ts";
import { projectId } from "./browser.ts";

const PAGE_SIZE = 100;
const HIT_LIMIT = 200;

interface ApiBlobSearch {
  path?: string;
  data?: string;
  startline?: number;
  ref?: string;
}

/** GitLab returns a plain snippet; find the matched line and its offsets ourselves. */
function lineMatches(text: string, query: string, options: SearchOptions): SearchMatch[] {
  const matches = searchMatches(text, query, options);
  if (!options.wholeWord) return matches;
  return matches.filter((match) => {
    const before = text[match.start - 1] ?? "";
    const after = text[match.end] ?? "";
    return !/\w/.test(before) && !/\w/.test(after);
  });
}

function resultHit(
  item: ApiBlobSearch,
  query: string,
  options: SearchOptions,
): SearchHit | undefined {
  const path = item.path?.trim();
  if (!path) return undefined;
  const startline = Number(item.startline);
  if (!Number.isSafeInteger(startline) || startline < 1) return undefined;
  const lines = (item.data ?? "").split(/\r?\n/);
  let lineText = lines[0] ?? "";
  let lineOffset = 0;
  let matches = lineMatches(lineText, query, options);
  for (let index = 1; index < lines.length; index++) {
    const candidate = lineMatches(lines[index] ?? "", query, options);
    if (!candidate.length) continue;
    lineText = lines[index] ?? "";
    lineOffset = index;
    matches = candidate;
    break;
  }
  if ((options.wholeWord || options.caseSensitive || options.regex) && !matches.length)
    return undefined;
  const text = lineText.trimEnd().slice(0, 500);
  return {
    path,
    line: startline + lineOffset,
    column: (matches[0]?.start ?? 0) + 1,
    text,
    matches,
  };
}

/**
 * Search a GitLab project at a ref. GitLab's blob search is part of Advanced Search; a CE
 * instance without it answers 400/404 and gets a readable error instead of a false empty result.
 */
export async function searchGitlabBlobs(repository: string, params: Record<string, string>) {
  const query = params.q ?? params.query ?? "";
  const options: SearchOptions = {
    caseSensitive: params.case === "true",
    wholeWord: params.word === "true",
    regex: params.regex === "true",
  };
  const ref = params.rev || params.sha || "";
  if (!query.trim()) return { hits: [], truncated: false };
  if (query.length > SEARCH_QUERY_MAX)
    throw new HttpError(400, `Запрос длиннее ${SEARCH_QUERY_MAX} символов`);
  if (ref && !/^[a-f0-9]{7,40}$/i.test(ref)) throw new HttpError(400, "Некорректный хеш коммита");
  if (options.regex) {
    try {
      new RegExp(query, options.caseSensitive ? "" : "i");
    } catch {
      throw new HttpError(400, "Некорректное регулярное выражение");
    }
  }
  const reader = await gitlabReader(repository);
  const id = projectId(reader.target.path);
  const hits: SearchHit[] = [];
  let page = 1;
  let next = "";
  do {
    const queryParams = new URLSearchParams({
      scope: "blobs",
      search: query,
      per_page: String(PAGE_SIZE),
      page: String(page),
    });
    if (ref) queryParams.set("ref", ref);
    let response;
    try {
      response = await reader.request<ApiBlobSearch[]>(`/projects/${id}/search?${queryParams}`);
    } catch (error) {
      if (error instanceof HttpError && (error.status === 400 || error.status === 404))
        throw new HttpError(
          400,
          "Поиск по коду GitLab недоступен: включите Advanced Search на инстансе",
        );
      throw error;
    }
    const rows = Array.isArray(response.data) ? response.data : [];
    for (const row of rows) {
      const hit = resultHit(row, query, options);
      if (hit) hits.push(hit);
      if (hits.length >= HIT_LIMIT) break;
    }
    next = response.headers.get("X-Next-Page") ?? "";
    page++;
  } while (next && hits.length < HIT_LIMIT && page <= 2);
  return { hits, truncated: !!next || hits.length >= HIT_LIMIT };
}
