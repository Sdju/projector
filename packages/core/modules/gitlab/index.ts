/** The only instance Projector is allowed to reach without explicit configuration. */
export const GITLAB_DEFAULT_INSTANCE = "gitlab.com";
export const GITLAB_PREFIX = "gl:/";

const INVALID_INSTANCE = "Укажите адрес GitLab вида https://gitlab.example.com";
const INVALID_PROJECT = "Укажите group/project или ссылку на проект GitLab";
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const PROJECT_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

export interface GitlabRepository {
  fullName: string;
  description: string;
  defaultBranch: string;
  branch: string;
  commit: string;
  private: boolean;
  empty: boolean;
  archived: boolean;
  visibility: string;
  webUrl: string;
  httpUrlToRepo: string;
  owner: string;
  avatarUrl: string;
  stars: number;
  forks: number;
  openIssues: number;
  openMergeRequests: number;
  language: string;
  languages: Record<string, number>;
  license: string;
  homepage: string;
  topics: string[];
  createdAt: string;
  updatedAt: string;
}

export interface GitlabEntry {
  name: string;
  path: string;
  type: "tree" | "blob" | "commit";
  mode: string;
  size?: number;
}

export interface GitlabFile {
  content: string;
  image: string | null;
  binary: boolean;
  size: number;
}

function authorityFromUrl(url: URL): string {
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "" && url.pathname !== "/")
  )
    throw new Error(INVALID_INSTANCE);
  return url.host.toLowerCase();
}

/**
 * `https://gitlab.example.com/`, `gitlab.example.com` or `gitlab.example.com:8443` as an authority.
 * Credentials, paths, queries and hashes are rejected: the install prefix belongs to settings.
 */
export function normalizeGitlabInstance(value: string): string {
  const raw = value.trim();
  if (!raw) throw new Error(INVALID_INSTANCE);
  let url: URL;
  try {
    url = new URL(SCHEME.test(raw) ? raw : `http://${raw}`);
  } catch {
    throw new Error(INVALID_INSTANCE);
  }
  return authorityFromUrl(url);
}

function projectSegments(name: string): string {
  const parts = name.split("/");
  if (
    parts.length < 2 ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        !PROJECT_SEGMENT.test(part) ||
        /\.(git|atom)$/i.test(part),
    )
  )
    throw new Error(INVALID_PROJECT);
  return parts.join("/");
}

function projectPathFromUrl(url: URL, instance?: string): string {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error(INVALID_PROJECT);
  if (instance) {
    let expected: string;
    try {
      expected = normalizeGitlabInstance(instance);
    } catch {
      throw new Error(INVALID_INSTANCE);
    }
    if (url.host.toLowerCase() !== expected)
      throw new Error("Ссылка ведёт на другой инстанс GitLab. Проверьте адрес");
  }
  return url.pathname;
}

/**
 * `group/sub/project` from a path or a link to an instance. `/-/tree/main`, `.git`, query and hash
 * are removed; when `instance` is passed, a link to another host is rejected.
 */
export function normalizeGitlabProjectPath(value: string, instance?: string): string {
  const raw = value.trim();
  if (!raw) throw new Error(INVALID_PROJECT);
  let name: string;
  if (SCHEME.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(INVALID_PROJECT);
    }
    name = projectPathFromUrl(url, instance);
  } else if (raw.startsWith(GITLAB_PREFIX)) {
    const rest = raw.slice(GITLAB_PREFIX.length);
    const slash = rest.indexOf("/");
    if (slash < 0) throw new Error(INVALID_PROJECT);
    const authority = rest.slice(0, slash);
    if (instance && normalizeGitlabInstance(authority) !== normalizeGitlabInstance(instance))
      throw new Error("Ссылка ведёт на другой инстанс GitLab. Проверьте адрес");
    name = rest.slice(slash + 1);
  } else {
    name = raw.split(/[?#]/, 1)[0] ?? "";
    if (instance) {
      const authority = normalizeGitlabInstance(instance);
      if (name.toLowerCase().startsWith(`${authority}/`)) name = name.slice(authority.length + 1);
    }
  }
  const project = name
    .replace(/\/-\/.*$/, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/i, "");
  return projectSegments(project);
}

/** Browser route of a GitLab project; the authority is always the first segment. */
export function gitlabProjectRoute(instance: string, path: string): string {
  const authority = normalizeGitlabInstance(instance);
  const name = normalizeGitlabProjectPath(path, authority);
  const host = encodeURIComponent(authority).replaceAll("%3A", ":");
  const segments = name.split("/").map(encodeURIComponent);
  return `/gl/projects/${host}/${segments.join("/")}`;
}

/** Stable text form: `gl:/<authority>/<group>/<project>`. */
export function gitlabProjectKey(instance: string, path: string): string {
  const authority = normalizeGitlabInstance(instance);
  return `${GITLAB_PREFIX}${authority}/${normalizeGitlabProjectPath(path, authority)}`;
}

const REMOTE_SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//;
const REMOTE_SCP = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/;
const WEB_REMOTE = new Set(["http", "https"]);
const GIT_REMOTE = new Set(["git", "ssh"]);

/**
 * `origin` remote of a local repository as an instance and a project path, or null when the
 * remote is not shaped like a GitLab project. Accepts HTTP(S), `git://`, `ssh://` and scp-like
 * `git@host:group/project.git`. An HTTP(S) authority keeps its port; git and SSH ports are not
 * web ports and are dropped. Host allowlisting belongs to the server, which knows the settings.
 */
export function gitlabRepositoryFromRemote(
  remote: string,
): { instance: string; path: string } | null {
  const value = remote.trim();
  if (!value) return null;
  let instance: string;
  let path: string;
  const scheme = REMOTE_SCHEME.exec(value)?.[1]?.toLowerCase();
  if (scheme) {
    if (!WEB_REMOTE.has(scheme) && !GIT_REMOTE.has(scheme)) return null;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    instance = WEB_REMOTE.has(scheme) ? url.host : url.hostname;
    path = url.pathname;
  } else {
    const match = REMOTE_SCP.exec(value);
    if (!match) return null;
    instance = match[1];
    path = match[2];
  }
  try {
    return {
      instance: normalizeGitlabInstance(instance),
      path: normalizeGitlabProjectPath(path),
    };
  } catch {
    return null;
  }
}
