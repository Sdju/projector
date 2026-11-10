import { HttpError, downloadFilename } from "../http/index.ts";
import type {
  Release,
  ReleaseAsset,
  ReleaseDetail,
  ReleaseList,
} from "@projector-ai/core/modules/workspace/index.ts";
import { gitlabReader, type GitlabTarget } from "./api.ts";
import { nextPage, projectId } from "./browser.ts";
import { gitlabUser, type GitlabUser } from "./trackers.ts";

const RELEASE_PAGE = 30;
const GITLAB_SOURCES = new Set(["zip", "tar.gz", "tar.bz2", "tar"]);

interface ApiLink {
  id?: number;
  name?: string;
  url?: string;
  direct_asset_url?: string;
  link_type?: string;
  external?: boolean;
}

interface ApiSource {
  format?: string;
  url?: string;
}

interface ApiRelease {
  name?: string;
  tag_name?: string;
  description?: string;
  created_at?: string;
  released_at?: string;
  upcoming_release?: boolean;
  author?: GitlabUser;
  assets?: {
    count?: number;
    sources?: ApiSource[];
    links?: ApiLink[];
  };
}

const CONTENT_TYPES: Record<string, string> = {
  zip: "application/zip",
  "tar.gz": "application/gzip",
  "tar.bz2": "application/x-bzip2",
  tar: "application/x-tar",
};

function hasControl(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function releaseTag(value: unknown): string {
  const tag = typeof value === "string" ? value.trim() : "";
  if (!tag || tag.length > 256 || hasControl(tag)) throw new HttpError(400, "Укажите тег релиза");
  return tag;
}

function pageNumber(value: unknown): number {
  const page = Number(value || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000)
    throw new HttpError(400, "Неверная страница");
  return page;
}

function sourceFormat(value: unknown): string {
  const format = typeof value === "string" ? value : "";
  if (!GITLAB_SOURCES.has(format)) throw new HttpError(400, "Неизвестный формат исходников");
  return format;
}

function release(raw: ApiRelease, target: GitlabTarget): Release {
  const tag = raw.tag_name || "";
  const links = Array.isArray(raw.assets?.links) ? raw.assets.links : [];
  const path = target.path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return {
    id: tag,
    tag,
    name: raw.name || "",
    draft: false,
    prerelease: false,
    upcoming: raw.upcoming_release === true,
    author: gitlabUser(raw.author),
    createdAt: raw.created_at || "",
    releasedAt: raw.released_at || raw.created_at || "",
    htmlUrl: tag
      ? `${target.base.replace(/\/$/, "")}/${path}/-/releases/${encodeURIComponent(tag)}`
      : "",
    assetCount: links.length,
    downloads: null,
  };
}

function sourceUrl(repository: string, tag: string, format: string): string {
  return `/api/integrations/gitlab/browse/release-source?${new URLSearchParams({
    repository,
    tag,
    format,
  })}`;
}

function assets(repository: string, raw: ApiRelease, tag: string): ReleaseAsset[] {
  const links = (Array.isArray(raw.assets?.links) ? raw.assets.links : []).flatMap(
    (link, index) => {
      const url = link.direct_asset_url || link.url || "";
      if (!/^https?:\/\//i.test(url)) return [];
      return [
        {
          id: `link:${link.id ?? index}`,
          name: link.name || "Ссылка",
          size: null,
          downloads: null,
          contentType: "",
          url,
          external: true,
          uploading: false,
          source: false,
          digest: "",
        } satisfies ReleaseAsset,
      ];
    },
  );
  const sources = (Array.isArray(raw.assets?.sources) ? raw.assets.sources : []).flatMap(
    (source) => {
      const format = source.format || "";
      if (!GITLAB_SOURCES.has(format)) return [];
      return [
        {
          id: `source:${format}`,
          name: `Исходный код (${format})`,
          size: null,
          downloads: null,
          contentType: CONTENT_TYPES[format] || "application/octet-stream",
          url: sourceUrl(repository, tag, format),
          external: false,
          uploading: false,
          source: true,
          digest: "",
        } satisfies ReleaseAsset,
      ];
    },
  );
  return [...links, ...sources];
}

/** One page of releases, newest first. GitLab has no explicit latest mark. */
export async function browseGitlabReleases(
  repository: string,
  params: Record<string, string> = {},
): Promise<ReleaseList> {
  const page = pageNumber(params.page);
  const reader = await gitlabReader(repository);
  const query = new URLSearchParams({ per_page: String(RELEASE_PAGE), page: String(page) });
  const response = await reader.request<ApiRelease[]>(
    `/projects/${projectId(reader.target.path)}/releases?${query}`,
  );
  const rows = Array.isArray(response.data) ? response.data : [];
  const releases = rows.map((item) => release(item, reader.target));
  return {
    releases,
    next: nextPage(response.headers, page, rows.length, RELEASE_PAGE),
    latestTag: releases.find((item) => !item.upcoming)?.tag || "",
  };
}

/** One release with its Markdown description and downloadable entries. */
export async function browseGitlabRelease(
  repository: string,
  value: unknown,
): Promise<ReleaseDetail> {
  const tag = releaseTag(value);
  const reader = await gitlabReader(repository);
  let raw: ApiRelease;
  try {
    raw = await reader.get<ApiRelease>(
      `/projects/${projectId(reader.target.path)}/releases/${encodeURIComponent(tag)}`,
    );
  } catch (error) {
    if (error instanceof HttpError && error.status === 404)
      throw new HttpError(404, "Релиз не найден или нет доступа");
    throw error;
  }
  const item = release(raw, reader.target);
  return {
    release: item,
    body: raw.description || "",
    assets: assets(repository, raw, item.tag || tag),
  };
}

function failure(status: number): HttpError {
  if (status === 401) return new HttpError(401, "Авторизация GitLab истекла. Подключитесь снова");
  if (status === 403)
    return new HttpError(403, "GitLab ограничил доступ. Проверьте права и лимит API");
  if (status === 404) return new HttpError(404, "Файл не найден или нет доступа");
  return new HttpError(400, `GitLab вернул ${status}. Проверьте права доступа`);
}

function headers(target: GitlabTarget): Record<string, string> {
  return {
    ...(target.token
      ? target.tokenType === "oauth"
        ? { Authorization: `Bearer ${target.token}` }
        : { "PRIVATE-TOKEN": target.token }
      : {}),
    Accept: "application/octet-stream",
    "User-Agent": "Projector",
  };
}

async function timedFetch(input: string | URL, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch {
    throw new HttpError(400, "GitLab не ответил вовремя");
  } finally {
    clearTimeout(timer);
  }
}

/** The token stays on the configured instance; a signed redirect is fetched without it. */
async function download(target: GitlabTarget, address: string): Promise<Response> {
  const base = new URL(target.base);
  const first = new URL(address, target.base);
  if (first.protocol !== "https:" && first.protocol !== base.protocol)
    throw new HttpError(400, "GitLab вернул небезопасную ссылку");
  if (first.origin !== base.origin) throw new HttpError(400, "GitLab вернул ссылку на другой хост");
  const response = await timedFetch(first, {
    headers: headers(target),
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new HttpError(400, "GitLab не вернул ссылку на файл");
    const next = new URL(location, first);
    if (next.protocol !== "https:" && next.protocol !== base.protocol)
      throw new HttpError(400, "GitLab вернул небезопасную ссылку");
    const followed = await timedFetch(next, {
      headers: next.origin === base.origin ? headers(target) : { "User-Agent": "Projector" },
      redirect: "follow",
    });
    if (!followed.ok) throw failure(followed.status);
    return followed;
  }
  if (!response.ok) throw failure(response.status);
  return response;
}

export async function downloadGitlabReleaseSource(
  repository: string,
  value: unknown,
  rawFormat: unknown,
): Promise<{ response: Response; name: string; contentType: string }> {
  const tag = releaseTag(value);
  const format = sourceFormat(rawFormat);
  const reader = await gitlabReader(repository);
  const raw = await reader.get<ApiRelease>(
    `/projects/${projectId(reader.target.path)}/releases/${encodeURIComponent(tag)}`,
  );
  const source = (raw.assets?.sources ?? []).find((item) => item.format === format);
  if (!source?.url) throw new HttpError(404, "Исходный код релиза не найден");
  const response = await download(reader.target, source.url);
  if ((response.headers.get("content-type") || "").startsWith("text/html"))
    throw new HttpError(401, "GitLab требует вход. Подключитесь в настройках интеграции");
  const name = reader.target.path.split("/").filter(Boolean).at(-1) || "release";
  return {
    response,
    name: downloadFilename(`${name}-${tag}.${format}`, `${name}.${format}`),
    contentType: CONTENT_TYPES[format] || "application/octet-stream",
  };
}
