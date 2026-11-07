import { HttpError, downloadFilename } from "../http/index.ts";
import { integrationConfig } from "../integration-store/index.ts";
import { githubResponse, repositoryName } from "./api.ts";
import { githubReader } from "./browser.ts";
import { user, type RemoteUser } from "./issues.ts";
import type {
  Release,
  ReleaseAsset,
  ReleaseDetail,
  ReleaseList,
} from "@projector/core/modules/workspace/index.ts";

const RELEASE_PAGE = 30;
const SOURCE_FORMAT = new Set(["zip", "tar.gz"]);

interface ApiAsset {
  id?: number;
  name?: string;
  size?: number;
  download_count?: number;
  content_type?: string;
  state?: string;
  digest?: string | null;
}

interface ApiRelease {
  id?: number;
  tag_name?: string;
  name?: string | null;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  created_at?: string;
  published_at?: string | null;
  html_url?: string;
  author?: RemoteUser | null;
  assets?: ApiAsset[];
}

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

function assetId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, "Укажите ассет релиза");
  return id;
}

function sourceFormat(value: unknown): string {
  const format = typeof value === "string" ? value : "";
  if (!SOURCE_FORMAT.has(format)) throw new HttpError(400, "Неизвестный формат исходников");
  return format;
}

function failure(status: number, notFound: string): HttpError {
  if (status === 401) return new HttpError(401, "Авторизация GitHub истекла. Войдите снова");
  if (status === 403)
    return new HttpError(403, "GitHub ограничил доступ. Проверьте права и лимит API");
  if (status === 404) return new HttpError(404, notFound);
  return new HttpError(400, `GitHub вернул ${status}. Проверьте права доступа и лимит API`);
}

function release(raw: ApiRelease): Release {
  const assets = Array.isArray(raw.assets) ? raw.assets : [];
  const downloads = assets.reduce(
    (total, asset) => total + (typeof asset.download_count === "number" ? asset.download_count : 0),
    0,
  );
  return {
    id: String(raw.id ?? ""),
    tag: raw.tag_name || "",
    name: raw.name || "",
    draft: raw.draft === true,
    prerelease: raw.prerelease === true,
    upcoming: false,
    author: user(raw.author ?? undefined),
    createdAt: raw.created_at || "",
    releasedAt: raw.published_at || raw.created_at || "",
    htmlUrl: raw.html_url || "",
    assetCount: assets.length,
    downloads,
  };
}

function assetUrl(repository: string, id: number, name: string): string {
  return `/api/integrations/github/browse/release-asset?${new URLSearchParams({
    repository,
    asset: String(id),
    name,
  })}`;
}

function sourceUrl(repository: string, tag: string, format: string): string {
  return `/api/integrations/github/browse/release-source?${new URLSearchParams({
    repository,
    tag,
    format,
  })}`;
}

function sourceAssets(repository: string, tag: string): ReleaseAsset[] {
  return [
    {
      id: "source:zip",
      name: "Исходный код (zip)",
      size: null,
      downloads: null,
      contentType: "application/zip",
      url: sourceUrl(repository, tag, "zip"),
      external: false,
      uploading: false,
      source: true,
      digest: "",
    },
    {
      id: "source:tar.gz",
      name: "Исходный код (tar.gz)",
      size: null,
      downloads: null,
      contentType: "application/gzip",
      url: sourceUrl(repository, tag, "tar.gz"),
      external: false,
      uploading: false,
      source: true,
      digest: "",
    },
  ];
}

function assets(repository: string, raw: ApiRelease, tag: string): ReleaseAsset[] {
  const attached = (Array.isArray(raw.assets) ? raw.assets : []).flatMap((asset) => {
    if (typeof asset.id !== "number" || !Number.isSafeInteger(asset.id)) return [];
    const name = asset.name || `asset-${asset.id}`;
    return [
      {
        id: String(asset.id),
        name,
        size: typeof asset.size === "number" ? asset.size : null,
        downloads: typeof asset.download_count === "number" ? asset.download_count : null,
        contentType: asset.content_type || "application/octet-stream",
        url: assetUrl(repository, asset.id, name),
        external: false,
        uploading: asset.state === "open",
        source: false,
        digest: asset.digest || "",
      } satisfies ReleaseAsset,
    ];
  });
  return [...attached, ...sourceAssets(repository, tag)];
}

async function request<T>(path: string, notFound: string): Promise<T> {
  const config = await integrationConfig("github");
  const token = config.enabled ? config.credentials.token || "" : "";
  const response = await githubResponse(path, token);
  if (!response.ok) throw failure(response.status, notFound);
  return (await response.json()) as T;
}

async function latestTag(read: <T>(path: string) => Promise<T>): Promise<string> {
  try {
    const latest = await read<{ tag_name?: string }>("/releases/latest");
    return latest.tag_name || "";
  } catch {
    return "";
  }
}

/** One page of releases, newest first, plus the tag GitHub marks as latest. */
export async function browseGithubReleases(
  repository: string,
  params: Record<string, string> = {},
): Promise<ReleaseList> {
  const page = pageNumber(params.page);
  const read = await githubReader(repository);
  const query = new URLSearchParams({ per_page: String(RELEASE_PAGE), page: String(page) });
  const [rows, latest] = await Promise.all([
    read<ApiRelease[]>(`/releases?${query}`),
    page === 1 ? latestTag(read) : Promise.resolve(""),
  ]);
  const releases = Array.isArray(rows) ? rows : [];
  return {
    releases: releases.map(release),
    next: releases.length === RELEASE_PAGE ? page + 1 : null,
    latestTag: latest,
  };
}

/** One release with its Markdown body and downloadable entries. */
export async function browseGithubRelease(
  repository: string,
  value: unknown,
): Promise<ReleaseDetail> {
  const tag = releaseTag(value);
  const raw = await request<ApiRelease>(
    `/repos/${repositoryName(repository)}/releases/tags/${encodeURIComponent(tag)}`,
    "Релиз не найден или нет доступа",
  );
  const item = release(raw);
  return {
    release: item,
    body: raw.body || "",
    assets: assets(repository, raw, item.tag || tag),
  };
}

async function timedFetch(input: string | URL, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "GitHub не ответил вовремя");
  } finally {
    clearTimeout(timer);
  }
}

/** Binary download: the token stays on api.github.com, the signed URL is fetched without it. */
async function download(path: string, notFound: string): Promise<Response> {
  const config = await integrationConfig("github");
  const token = config.enabled ? config.credentials.token || "" : "";
  const response = await timedFetch(`https://api.github.com${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: "application/octet-stream",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Projector",
    },
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new HttpError(400, "GitHub не вернул ссылку на файл");
    const target = new URL(location, "https://api.github.com");
    if (target.protocol !== "https:") throw new HttpError(400, "GitHub вернул небезопасную ссылку");
    const followed = await timedFetch(target, {
      headers: { "User-Agent": "Projector" },
      redirect: "follow",
    });
    if (!followed.ok) throw failure(followed.status, notFound);
    return followed;
  }
  if (!response.ok) throw failure(response.status, notFound);
  return response;
}

export async function downloadGithubReleaseAsset(
  repository: string,
  value: unknown,
  name: unknown,
): Promise<{ response: Response; name: string; contentType: string }> {
  const id = assetId(value);
  const target = downloadFilename(typeof name === "string" ? name : "", `asset-${id}`);
  return {
    response: await download(
      `/repos/${repositoryName(repository)}/releases/assets/${id}`,
      "Ассет не найден или нет доступа",
    ),
    name: target,
    contentType: "application/octet-stream",
  };
}

export async function downloadGithubReleaseSource(
  repository: string,
  value: unknown,
  rawFormat: unknown,
): Promise<{ response: Response; name: string; contentType: string }> {
  const tag = releaseTag(value);
  const format = sourceFormat(rawFormat);
  const name = repositoryName(repository);
  const extension = format === "zip" ? "zip" : "tar.gz";
  return {
    response: await download(
      `/repos/${name}/${format === "zip" ? "zipball" : "tarball"}/${encodeURIComponent(tag)}`,
      "Исходный код релиза не найден",
    ),
    name: downloadFilename(`${name.split("/")[1]}-${tag}.${extension}`),
    contentType: format === "zip" ? "application/zip" : "application/gzip",
  };
}
