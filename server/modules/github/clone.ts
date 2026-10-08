import { isAbsolute } from "node:path";
import { parseDockerEnvironment, prepareDockerEnvironment } from "../environments/index.ts";
import { cloneGithubContainer } from "./container.ts";
import { integrationConfig } from "../integration-store/index.ts";
import { HttpError } from "../http/index.ts";
import type { DockerEnvironment } from "../../../core/modules/environment/index.ts";
import { cloneOverHttps, importRepository } from "../git-import/index.ts";
import type { CloneHooks } from "../git-import/index.ts";
import { DEFAULT_DIRECTORY, authorized, github, repositoryName } from "./api.ts";

/** Host absolute path, or a `~` / `~/…` home shortcut. Drive letters count on Windows. */
function acceptsCloneDirectory(directory: string): boolean {
  if (directory.includes("\0")) return false;
  const value = directory.trim();
  return isAbsolute(value) || value === "~" || value.startsWith("~/") || value.startsWith("~\\");
}

const credentials = {
  username: "x-access-token",
  tokenEnv: "PROJECTOR_GITHUB_TOKEN",
  failure:
    "Не удалось клонировать репозиторий. Проверьте Git, сеть и права токена на содержимое репозитория",
};
const cloneGithubRepository = (
  repository: string,
  destination: string,
  token: string,
  signal?: AbortSignal,
) =>
  cloneOverHttps(`https://github.com/${repository}.git`, destination, token, credentials, signal);

export async function importGithubProject(body: Record<string, unknown>) {
  const config = await authorized();
  return saveGithubProject(
    body,
    config.settings.directory || DEFAULT_DIRECTORY,
    config.credentials.token,
  );
}
export async function cloneGithubProject(body: Record<string, unknown>, hooks: CloneHooks = {}) {
  const config = await integrationConfig("github");
  const docker = await integrationConfig("docker");
  const environment = parseDockerEnvironment(
    body.environment,
    docker.settings.context || "default",
  );
  const directory = body.directory ?? (config.settings.directory || DEFAULT_DIRECTORY);
  if (typeof directory !== "string" || !acceptsCloneDirectory(directory))
    throw new HttpError(400, "Укажите абсолютный путь к папке или ~/папка");
  if (environment) {
    if (directory.includes(","))
      throw new HttpError(400, "Docker-путь не должен содержать запятую");
    hooks.phase?.("preparing");
    await prepareDockerEnvironment(environment, {
      signal: hooks.signal,
      onPull: () => hooks.phase?.("pulling"),
    });
  }
  return saveGithubProject(
    body,
    directory,
    config.enabled ? config.credentials.token || "" : "",
    environment,
    hooks,
  );
}
async function saveGithubProject(
  body: Record<string, unknown>,
  base: string,
  token: string,
  environment?: DockerEnvironment,
  hooks: CloneHooks = {},
) {
  const repository = repositoryName(body.repository);
  await github(`/repos/${repository}`, token);
  return importRepository({
    directory: base,
    segments: [repository.slice(repository.lastIndexOf("/") + 1)],
    environment,
    hooks,
    clone: ({ staging, checkout }) =>
      environment
        ? cloneGithubContainer(repository, staging, token, environment, hooks.signal)
        : cloneGithubRepository(repository, checkout, token, hooks.signal),
  });
}
