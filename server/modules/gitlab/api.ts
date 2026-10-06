import { join } from "node:path";
import { os } from "../../../core/modules/os/index.ts";
import {
  integrationConfig,
  updateIntegration,
  revealIntegrationToken,
  fieldText as text,
} from "../integration-store/index.ts";
import { HttpError } from "../http/index.ts";
import { expandPath } from "../projects/index.ts";

export const GITLAB_URL = "https://gitlab.com";
export const GITLAB_DIRECTORY = join(os.homeDirectory(), "Projects");

/** Normalized instance origin (`https://gitlab.example.com[/prefix]`); credentials and queries are rejected. */
export function gitlabBaseUrl(value: unknown): string {
  const raw = text(value) || GITLAB_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, "Укажите адрес GitLab вида https://gitlab.example.com");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new HttpError(400, "Укажите адрес GitLab вида https://gitlab.example.com");
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}
/** `group/subgroup/project` from a path or a link to the configured instance. */
export function gitlabProjectName(value: unknown, base: string = GITLAB_URL): string {
  let name = text(value);
  if (name.startsWith(`${base}/`)) name = name.slice(base.length + 1);
  name = name
    .split(/[?#]/)[0]
    .replace(/\/-\/.*$/, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/, "");
  const parts = name.split("/");
  if (
    parts.length < 2 ||
    parts.some((part) => !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(part) || /\.(git|atom)$/.test(part))
  )
    throw new HttpError(400, "Укажите group/project или ссылку на проект GitLab");
  return name;
}
export async function gitlab<T>(base: string, path: string, token: string = ""): Promise<T> {
  const response = await fetch(`${base}/api/v4${path}`, {
    headers: {
      ...(token ? { "PRIVATE-TOKEN": token } : {}),
      Accept: "application/json",
      "User-Agent": "Projector",
    },
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  }).catch(() => {
    throw new HttpError(400, "GitLab недоступен. Проверьте адрес и сеть");
  });
  if (!response.ok)
    throw new HttpError(
      [401, 403, 404, 429].includes(response.status) ? response.status : 400,
      response.status === 401
        ? "Авторизация GitLab недействительна. Войдите снова"
        : response.status === 404
          ? "Проект не найден или нет доступа"
          : `GitLab вернул ${response.status}. Проверьте права токена и лимит API`,
    );
  return (await response.json()) as T;
}
export async function gitlabAuthorized() {
  const config = await integrationConfig("gitlab");
  if (!config.enabled) throw new HttpError(400, "Включите интеграцию GitLab в настройках");
  if (!config.credentials.token)
    throw new HttpError(401, "Подключите GitLab в настройках интеграции");
  return { ...config, base: gitlabBaseUrl(config.settings.url) };
}
export async function gitlabStatus() {
  const config = await integrationConfig("gitlab");
  return {
    id: "gitlab",
    name: "GitLab",
    description: "Импорт проектов GitLab (gitlab.com и self-hosted) в локальный каталог",
    enabled: config.enabled,
    settings: {
      clientId: "",
      url: config.settings.url || GITLAB_URL,
      directory: config.settings.directory || GITLAB_DIRECTORY,
    },
    connected: !!config.credentials.token,
    account: config.credentials.login || null,
  };
}
export const revealGitlabToken = () => revealIntegrationToken("gitlab");
export async function configureGitlab(body: Record<string, unknown>) {
  if (typeof body.enabled !== "boolean") throw new HttpError(400, "Укажите состояние интеграции");
  const directory = text(body.directory);
  if (!directory) throw new HttpError(400, "Укажите папку для импорта");
  const url = gitlabBaseUrl(body.url);
  await updateIntegration("gitlab", (config) => ({
    ...config,
    enabled: body.enabled as boolean,
    settings: { url, directory: expandPath(directory) },
    // A token belongs to one instance: another address means signing in again.
    credentials: config.settings.url && config.settings.url !== url ? {} : config.credentials,
  }));
  return gitlabStatus();
}
export async function connectGitlab(body: Record<string, unknown>) {
  const token = text(body.token);
  if (!token || /[\r\n]/.test(token)) throw new HttpError(400, "Укажите корректный токен GitLab");
  const config = await integrationConfig("gitlab");
  if (!config.enabled) throw new HttpError(400, "Включите интеграцию GitLab в настройках");
  const base = gitlabBaseUrl(config.settings.url);
  const account = await gitlab<{ username: string }>(base, "/user", token);
  await updateIntegration("gitlab", (current) => {
    if (!current.enabled || gitlabBaseUrl(current.settings.url) !== base)
      throw new HttpError(400, "Настройки изменились. Подключитесь заново");
    return { ...current, credentials: { token, login: account.username } };
  });
  return gitlabStatus();
}
export async function disconnectGitlab() {
  await updateIntegration("gitlab", (config) => ({ ...config, credentials: {} }));
  return gitlabStatus();
}

interface ApiProject {
  path_with_namespace: string;
  description: string | null;
  visibility: string;
  web_url: string;
}
const mapProject = (project: ApiProject) => ({
  fullName: project.path_with_namespace,
  description: project.description ?? "",
  private: project.visibility !== "public",
  url: project.web_url,
});
export async function gitlabRepositories(page: number) {
  const config = await gitlabAuthorized();
  if (!Number.isInteger(page) || page < 1 || page > 1000)
    throw new HttpError(400, "Неверная страница");
  const projects = await gitlab<ApiProject[]>(
    config.base,
    `/projects?membership=true&simple=true&order_by=last_activity_at&per_page=50&page=${page}`,
    config.credentials.token,
  );
  return { repositories: projects.map(mapProject), page, hasMore: projects.length === 50 };
}

export interface GitlabSearchHit {
  fullName: string;
  description: string;
  private: boolean;
  url: string;
}
/**
 * Launcher search. The account's own projects (first 100 by activity) are matched locally by full
 * path, so `group/`, `group/part` and short words work; GitLab's own search needs 3+ characters
 * and no namespace, so it only adds other (public) projects for the last path segment.
 */
export async function searchGitlabProjects(query: string): Promise<GitlabSearchHit[]> {
  const config = await integrationConfig("gitlab");
  const token = config.enabled ? config.credentials.token || "" : "";
  const base = gitlabBaseUrl(config.settings.url);
  const needle = query.trim().toLowerCase().replace(/^\/+/, "");
  if (!needle && !token) throw new HttpError(401, "Подключите GitLab в настройках интеграции");
  const found = new Map<string, ApiProject>();
  if (token) {
    const own = await gitlab<ApiProject[]>(
      base,
      "/projects?membership=true&simple=true&order_by=last_activity_at&per_page=100",
      token,
    );
    for (const project of own)
      if (project.path_with_namespace.toLowerCase().includes(needle))
        found.set(project.path_with_namespace, project);
  }
  const name = needle.split("/").pop()!.replace(/[^\w.-]/g, "");
  if (found.size < 10 && name.length >= 3) {
    const params = new URLSearchParams({ simple: "true", per_page: "10", search: name });
    const others = await gitlab<ApiProject[]>(base, `/projects?${params}`, token);
    for (const project of others)
      if (project.path_with_namespace.toLowerCase().includes(needle))
        found.set(project.path_with_namespace, project);
  }
  return [...found.values()].slice(0, 10).map(mapProject);
}
