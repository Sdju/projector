import {
  integrationConfig,
  updateIntegration,
  fieldText as text,
} from "../integration-store/index.ts";
import { HttpError } from "../http/index.ts";
import {
  GITLAB_DEFAULT_INSTANCE,
  GITLAB_PREFIX,
  normalizeGitlabInstance,
  normalizeGitlabProjectPath,
} from "../../../core/modules/gitlab/index.ts";
import { GITLAB_URL, gitlabBaseUrl } from "./base.ts";
import { gitlabStatus } from "./connection.ts";
import { clearGitlabSessions, gitlabTokenExpiring, refreshGitlabToken } from "./oauth.ts";

export { GITLAB_DIRECTORY, GITLAB_URL, gitlabBaseUrl } from "./base.ts";
export {
  beginGitlabLogin,
  configureGitlab,
  disconnectGitlab,
  gitlabStatus,
  pollGitlabLogin,
  revealGitlabToken,
} from "./connection.ts";
export { refreshGitlabToken } from "./oauth.ts";
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
/** `<authority>/<group>/<project>` split into an instance and a path. */
function gitlabRepositoryParts(value: unknown, configuredBase = GITLAB_URL) {
  let raw = text(value);
  if (raw.startsWith(GITLAB_PREFIX)) raw = raw.slice(GITLAB_PREFIX.length);
  let instance: string;
  let path: string;
  try {
    if (raw.includes("://")) {
      const url = new URL(raw);
      instance = normalizeGitlabInstance(url.origin);
      path = normalizeGitlabProjectPath(raw, instance);
      // A link carries the install prefix; the API path must not.
      const prefix = new URL(configuredBase).pathname.replace(/^\/+|\/+$/g, "");
      if (
        instance === normalizeGitlabInstance(new URL(configuredBase).origin) &&
        prefix &&
        path.startsWith(`${prefix}/`)
      )
        path = path.slice(prefix.length + 1);
    } else {
      const slash = raw.indexOf("/");
      if (slash < 1) throw new Error("Укажите group/project или ссылку на проект GitLab");
      instance = normalizeGitlabInstance(raw.slice(0, slash));
      path = normalizeGitlabProjectPath(raw.slice(slash + 1), instance);
    }
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
  return { instance, path };
}

export type GitlabTokenType = "pat" | "oauth";

export interface GitlabTarget {
  instance: string;
  path: string;
  base: string;
  token: string;
  /** Omitted for anonymous and PAT requests, where `PRIVATE-TOKEN` is the legacy default. */
  tokenType?: GitlabTokenType;
}

export function gitlabCredentialsTokenType(credentials: Record<string, string>): GitlabTokenType {
  return credentials.kind === "oauth" ? "oauth" : "pat";
}

/** Refreshes an expiring OAuth access token before it is used; PAT tokens never refresh. */
export async function gitlabAccessToken(
  base: string,
  credentials: Record<string, string>,
): Promise<string> {
  const token = credentials.token || "";
  if (!token) return "";
  if (gitlabTokenExpiring(credentials)) return refreshGitlabToken(base);
  return token;
}

async function gitlabTargetToken(
  config: { enabled: boolean; credentials: Record<string, string> },
  base: string,
): Promise<{ token: string; tokenType?: GitlabTokenType }> {
  if (!config.enabled) return { token: "" };
  const token = await gitlabAccessToken(base, config.credentials);
  if (!token) return { token: "" };
  return config.credentials.kind === "oauth" ? { token, tokenType: "oauth" } : { token };
}

/**
 * The only hosts Projector may reach: `gitlab.com` anonymously, or the exact instance from settings.
 * The token never goes to a host that is not the configured base.
 */
export async function gitlabTarget(repository: unknown): Promise<GitlabTarget> {
  const config = await integrationConfig("gitlab");
  const configuredBase = gitlabBaseUrl(config.settings.url);
  const configuredInstance = normalizeGitlabInstance(new URL(configuredBase).origin);
  const { instance, path } = gitlabRepositoryParts(repository, configuredBase);
  if (instance === GITLAB_DEFAULT_INSTANCE) {
    // A token for a self-hosted instance must not follow a gitlab.com link.
    const access =
      configuredInstance === GITLAB_DEFAULT_INSTANCE
        ? await gitlabTargetToken(config, GITLAB_URL)
        : { token: "" };
    return { instance, path, base: GITLAB_URL, ...access };
  }
  if (instance === configuredInstance) {
    const access = await gitlabTargetToken(config, configuredBase);
    return { instance, path, base: configuredBase, ...access };
  }
  throw new HttpError(
    403,
    "Проект на другом хосте GitLab недоступен. Откройте проект на gitlab.com или настройте этот инстанс",
  );
}

/**
 * Clone target from a relative `group/project`, a canonical `<authority>/<path>`, `gl:/…` or a
 * link. A relative path belongs to the configured instance; anything that names a host goes
 * through `gitlabTarget`, so the allowlist and the token rules stay in one place.
 */
export async function gitlabCloneTarget(value: unknown): Promise<GitlabTarget> {
  const raw = text(value);
  if (!raw) throw new HttpError(400, "Укажите group/project или ссылку на проект GitLab");
  const config = await integrationConfig("gitlab");
  const configuredInstance = normalizeGitlabInstance(
    new URL(gitlabBaseUrl(config.settings.url)).origin,
  );
  const first = raw.split("/", 1)[0] ?? "";
  let explicit = raw.startsWith(GITLAB_PREFIX) || raw.includes("://");
  if (!explicit) {
    try {
      const authority = normalizeGitlabInstance(first);
      explicit = authority === configuredInstance || authority === GITLAB_DEFAULT_INSTANCE;
    } catch {
      // The first segment is a group, not a host.
    }
  }
  if (explicit) return gitlabTarget(raw);
  let path: string;
  try {
    path = normalizeGitlabProjectPath(raw, configuredInstance);
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
  return gitlabTarget(`${configuredInstance}/${path}`);
}

function gitlabError(response: Response): HttpError {
  if (response.status === 401)
    return new HttpError(401, "Авторизация GitLab истекла или недействительна. Войдите снова");
  if (response.status === 404) return new HttpError(404, "Проект не найден или нет доступа");
  if (response.status === 429) return new HttpError(429, "Превышен лимит GitLab. Повторите позже");
  if (response.status === 403)
    return new HttpError(403, "GitLab запретил доступ. Проверьте права токена");
  return new HttpError(
    response.status,
    `GitLab вернул ${response.status}. Проверьте права токена и лимит API`,
  );
}

export interface GitlabRequestInit {
  method?: string;
  body?: BodyInit;
  headers?: Record<string, string>;
  tokenType?: GitlabTokenType;
}

/** Low-level response for endpoints that are not JSON, such as raw file bytes. */
export async function gitlabFetch(
  base: string,
  path: string,
  token: string = "",
  init: GitlabRequestInit = {},
): Promise<Response> {
  const { tokenType = "pat", ...request } = init;
  let response: Response;
  try {
    response = await fetch(`${base}/api/v4${path}`, {
      ...request,
      headers: {
        ...(token
          ? tokenType === "oauth"
            ? { Authorization: `Bearer ${token}` }
            : { "PRIVATE-TOKEN": token }
          : {}),
        Accept: "application/json",
        "User-Agent": "Projector",
        ...request.headers,
      },
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "GitLab недоступен. Проверьте адрес и сеть");
  }
  if (!response.ok) throw gitlabError(response);
  return response;
}

export interface GitlabPage<T> {
  data: T;
  headers: Headers;
}

/** JSON request with the pagination headers still available to the caller. */
export async function gitlabRequest<T>(
  base: string,
  path: string,
  token: string = "",
  init: GitlabRequestInit = {},
): Promise<GitlabPage<T>> {
  const response = await gitlabFetch(base, path, token, init);
  const data = (response.status === 204 ? undefined : await response.json()) as T;
  return { data, headers: response.headers };
}

/** Raw bytes for assets; the caller decides the MIME type. */
export async function gitlabBytes(
  base: string,
  path: string,
  token: string = "",
  init: GitlabRequestInit = {},
) {
  const response = await gitlabFetch(base, path, token, init);
  return { bytes: Buffer.from(await response.arrayBuffer()), headers: response.headers };
}

export interface GitlabReader {
  target: GitlabTarget;
  request<T>(path: string, init?: GitlabRequestInit): Promise<GitlabPage<T>>;
  get<T>(path: string, init?: GitlabRequestInit): Promise<T>;
  /** Low-level response for endpoints that are not JSON, with the same OAuth recovery. */
  fetch(path: string, init?: GitlabRequestInit): Promise<Response>;
}

/**
 * One repository-bound reader: target selection and OAuth recovery stay in one place. An OAuth 401
 * gets exactly one forced refresh and one retry; a PAT 401 is returned to the caller unchanged.
 */
export async function gitlabReader(repository: unknown): Promise<GitlabReader> {
  const target = await gitlabTarget(repository);
  const send = <T>(path: string, init: GitlabRequestInit = {}) =>
    gitlabRequest<T>(target.base, path, target.token, {
      ...init,
      tokenType: target.tokenType,
    });
  const recover = async <T>(run: () => Promise<T>) => {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 401 || target.tokenType !== "oauth")
        throw error;
      target.token = await refreshGitlabToken(target.base, true);
      return run();
    }
  };
  const request = <T>(path: string, init: GitlabRequestInit = {}) =>
    recover(() => send<T>(path, init));
  const raw = (path: string, init: GitlabRequestInit = {}) =>
    recover(() =>
      gitlabFetch(target.base, path, target.token, { ...init, tokenType: target.tokenType }),
    );
  return {
    target,
    request,
    get: async <T>(path: string, init?: GitlabRequestInit) => (await request<T>(path, init)).data,
    fetch: raw,
  };
}

export async function gitlab<T>(
  base: string,
  path: string,
  token: string = "",
  init: GitlabRequestInit = {},
): Promise<T> {
  return (await gitlabRequest<T>(base, path, token, init)).data;
}
export async function gitlabAuthorized() {
  const config = await integrationConfig("gitlab");
  if (!config.enabled) throw new HttpError(400, "Включите интеграцию GitLab в настройках");
  if (!config.credentials.token)
    throw new HttpError(401, "Подключите GitLab в настройках интеграции");
  return { ...config, base: gitlabBaseUrl(config.settings.url) };
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
  clearGitlabSessions();
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
  const tokenType = gitlabCredentialsTokenType(config.credentials);
  const token = await gitlabAccessToken(config.base, config.credentials);
  const projects = await gitlab<ApiProject[]>(
    config.base,
    `/projects?membership=true&simple=true&order_by=last_activity_at&per_page=50&page=${page}`,
    token,
    { tokenType },
  );
  return { repositories: projects.map(mapProject), page, hasMore: projects.length === 50 };
}
