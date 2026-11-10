import { githubProjectRoute } from "@projector-ai/core/modules/github/index.ts";
import {
  GITLAB_DEFAULT_INSTANCE,
  GITLAB_PREFIX,
  gitlabProjectRoute,
  normalizeGitlabInstance,
  normalizeGitlabProjectPath,
} from "@projector-ai/core/modules/gitlab/index.ts";
import {
  parseProjectRef,
  pathFromUrlSegments,
  pathToUrlSegments,
} from "@projector-ai/core/modules/project/index.ts";
/** Route params are already decoded by Vue Router. */
export function projectPathFromParams(value: string | string[] | undefined): string {
  const parts = Array.isArray(value) ? value : (value ?? "").split("/");
  return pathFromUrlSegments(parts);
}

export function githubRepositoryFromParams(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value : [value ?? ""]).join("/");
}

/** First route segment is the instance authority, the rest is the project path. */
export function gitlabProjectFromParams(value: string | string[] | undefined): {
  instance: string;
  path: string;
} {
  const parts = Array.isArray(value) ? value : (value ?? "").split("/");
  const [instance = "", ...path] = parts;
  return { instance, path: path.join("/") };
}

export function projectRoute(path: string): string {
  const ref = parseProjectRef(path);
  if (ref.kind === "github") return githubProjectRoute(ref.repository);
  if (ref.kind === "gitlab") return gitlabProjectRoute(ref.instance, ref.path);
  const segments = pathToUrlSegments(path).map((segment) =>
    encodeURIComponent(segment).replaceAll("%3A", ":"),
  );
  return `/projects/${segments.length ? segments.join("/") : "%2F"}`;
}

interface ConfiguredGitlab {
  instance: string;
  prefix: string;
}

/** The configured instance without credentials, query or hash; the prefix belongs to links, not paths. */
function configuredGitlab(value: string): ConfiguredGitlab | null {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return {
      instance: normalizeGitlabInstance(url.origin),
      prefix: url.pathname.replace(/^\/+|\/+$/g, ""),
    };
  } catch {
    try {
      return { instance: normalizeGitlabInstance(raw), prefix: "" };
    } catch {
      return null;
    }
  }
}

function looksLikeGitlabInstance(segment: string, configured: ConfiguredGitlab | null): boolean {
  if (!segment) return false;
  if (segment === GITLAB_DEFAULT_INSTANCE || segment === configured?.instance) return true;
  if (!/[.:]/.test(segment)) return false;
  try {
    normalizeGitlabInstance(segment);
    return true;
  } catch {
    return false;
  }
}

function stripConfiguredPrefix(
  path: string,
  instance: string,
  configured: ConfiguredGitlab | null,
): string {
  if (!configured || configured.instance !== instance || !configured.prefix) return path;
  return path.startsWith(`${configured.prefix}/`) ? path.slice(configured.prefix.length + 1) : path;
}

function routeFromAuthority(
  value: string,
  configured: ConfiguredGitlab | null,
  stripPrefix: boolean,
): string {
  const slash = value.indexOf("/");
  if (slash < 1) throw new Error("Укажите group/project или ссылку на проект GitLab");
  const instance = normalizeGitlabInstance(value.slice(0, slash));
  let path = normalizeGitlabProjectPath(value.slice(slash + 1), instance);
  if (stripPrefix) path = stripConfiguredPrefix(path, instance, configured);
  return gitlabProjectRoute(instance, path);
}

/**
 * Browser route from `gl:/<instance>/<path>`, a link, `<instance>/<path>` or `group/project`.
 * A relative path belongs to the configured instance, or to gitlab.com when none is configured.
 */
export function gitlabOpenRoute(value: string, configuredUrl = ""): string {
  const raw = value.trim();
  if (!raw) throw new Error("Укажите group/project или ссылку на проект GitLab");
  const configured = configuredGitlab(configuredUrl);
  if (raw.startsWith(GITLAB_PREFIX))
    return routeFromAuthority(
      raw.slice(GITLAB_PREFIX.length).replace(/\/+$/, ""),
      configured,
      false,
    );
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error("Укажите group/project или ссылку на проект GitLab");
    }
    const instance = normalizeGitlabInstance(url.origin);
    const path = stripConfiguredPrefix(
      normalizeGitlabProjectPath(raw, instance),
      instance,
      configured,
    );
    return gitlabProjectRoute(instance, path);
  }
  const first = raw.split("/", 1)[0] ?? "";
  if (looksLikeGitlabInstance(first, configured)) return routeFromAuthority(raw, configured, false);
  const instance = configured?.instance || GITLAB_DEFAULT_INSTANCE;
  return gitlabProjectRoute(instance, normalizeGitlabProjectPath(raw, instance));
}
