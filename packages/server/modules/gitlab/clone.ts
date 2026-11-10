import { isAbsolute } from "node:path";
import {
  GITLAB_DEFAULT_INSTANCE,
  normalizeGitlabProjectPath,
} from "@projector-ai/core/modules/gitlab/index.ts";
import { parseDockerEnvironment, prepareDockerEnvironment } from "../environments/index.ts";
import { integrationConfig } from "../integration-store/index.ts";
import { HttpError } from "../http/index.ts";
import { cloneOverHttps, importRepository } from "../git-import/index.ts";
import type { CloneHooks } from "../git-import/index.ts";
import { gitlab, gitlabCloneTarget, GITLAB_DIRECTORY } from "./api.ts";
import { cloneGitlabContainer } from "./container.ts";

/** Host absolute path, or a `~` / `~/…` home shortcut. Drive letters count on Windows. */
function acceptsCloneDirectory(directory: string): boolean {
  if (directory.includes("\0")) return false;
  const value = directory.trim();
  return isAbsolute(value) || value === "~" || value.startsWith("~/") || value.startsWith("~\\");
}

const credentials = {
  username: "oauth2",
  tokenEnv: "PROJECTOR_GITLAB_TOKEN",
  failure: "Не удалось клонировать проект. Проверьте Git, сеть и права токена (read_repository)",
};

interface ApiProject {
  path_with_namespace: string;
  http_url_to_repo: string;
}

/** Clones a GitLab project into `<folder>/<group>/<subgroup>/<project>` and registers it. */
export async function cloneGitlabProject(body: Record<string, unknown>, hooks: CloneHooks = {}) {
  const config = await integrationConfig("gitlab");
  const docker = await integrationConfig("docker");
  const environment = parseDockerEnvironment(
    body.environment,
    docker.settings.context || "default",
  );
  const directory = body.directory ?? (config.settings.directory || GITLAB_DIRECTORY);
  if (typeof directory !== "string" || !acceptsCloneDirectory(directory))
    throw new HttpError(400, "Укажите абсолютный путь к папке или ~/папка");
  const target = await gitlabCloneTarget(body.repository);
  // A disabled integration may still clone a public gitlab.com project anonymously.
  if (target.instance !== GITLAB_DEFAULT_INSTANCE && !config.enabled)
    throw new HttpError(400, "Включите интеграцию GitLab в настройках");
  if (environment) {
    if (directory.includes(","))
      throw new HttpError(400, "Docker-путь не должен содержать запятую");
    hooks.phase?.("preparing");
    await prepareDockerEnvironment(environment, {
      signal: hooks.signal,
      onPull: () => hooks.phase?.("pulling"),
    });
  }
  // The API checks access and returns the exact clone URL; the path in settings is only a hint.
  const project = await gitlab<ApiProject>(
    target.base,
    `/projects/${encodeURIComponent(target.path)}`,
    target.token,
    { tokenType: target.tokenType },
  );
  let path: string;
  try {
    path = normalizeGitlabProjectPath(project.path_with_namespace, target.instance);
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
  const url = typeof project.http_url_to_repo === "string" ? project.http_url_to_repo.trim() : "";
  if (!url) throw new HttpError(400, "GitLab не вернул адрес для клонирования проекта");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(400, "GitLab не вернул корректный адрес для клонирования проекта");
  }
  // The token travels with this URL, so it may only point at the instance we already allow.
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.host.toLowerCase() !== target.instance
  )
    throw new HttpError(400, "GitLab не вернул корректный адрес для клонирования проекта");
  return importRepository({
    directory,
    segments: path.split("/"),
    environment,
    hooks,
    clone: ({ staging, checkout }) =>
      environment
        ? cloneGitlabContainer(url, staging, target.token, environment, hooks.signal)
        : cloneOverHttps(url, checkout, target.token, credentials, hooks.signal),
  });
}

/** Settings-form import: the same path as the clone dialog, with the configured folder. */
export function importGitlabProject(body: Record<string, unknown>) {
  return cloneGitlabProject(body);
}
