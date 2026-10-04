import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, writeFile, rm, rename, lstat, rmdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseDockerEnvironment, prepareDockerEnvironment } from "../environments/index.ts";
import { cloneGithubContainer } from "./github-container.ts";
import { integrationConfig } from "./store.ts";
import { HttpError } from "../http/index.ts";
import { expandPath, inspectProject, loadProjects, updateProjects } from "../projects/index.ts";
import type { Project } from "../projects/index.ts";
import { DEFAULT_DIRECTORY, authorized, github, repositoryName } from "./github.ts";

const exec = promisify(execFile);
const imports = new Set<string>();
export async function cloneGithubRepository(
  repository: string,
  destination: string,
  token: string,
  signal?: AbortSignal,
) {
  const helper = await mkdtemp(join(tmpdir(), "projector-git-"));
  try {
    const askpass = join(helper, "askpass");
    await writeFile(
      askpass,
      '#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" "x-access-token" ;; *) printf "%s\\n" "$PROJECTOR_GITHUB_TOKEN" ;; esac\n',
      { mode: 0o700 },
    );
    await exec(
      "git",
      [
        "-c",
        "credential.helper=",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "http.followRedirects=false",
        "clone",
        "--",
        `https://github.com/${repository}.git`,
        destination,
      ],
      {
        env: {
          ...process.env,
          GIT_ASKPASS: askpass,
          GIT_TERMINAL_PROMPT: "0",
          PROJECTOR_GITHUB_TOKEN: token,
        },
        timeout: 300_000,
        maxBuffer: 1024 * 1024,
        signal,
      },
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new HttpError(
      400,
      "Не удалось клонировать репозиторий. Проверьте Git, сеть и права токена на содержимое репозитория",
    );
  } finally {
    await rm(helper, { recursive: true, force: true });
  }
}
export async function importGithubProject(body: Record<string, unknown>) {
  const config = await authorized();
  return saveGithubProject(
    body,
    config.settings.directory || DEFAULT_DIRECTORY,
    config.credentials.token,
  );
}
export interface CloneHooks {
  signal?: AbortSignal;
  phase?: (phase: "preparing" | "pulling" | "cloning" | "finishing") => void;
}
export async function cloneGithubProject(body: Record<string, unknown>, hooks: CloneHooks = {}) {
  const config = await integrationConfig("github");
  const docker = await integrationConfig("docker");
  const environment = parseDockerEnvironment(
    body.environment,
    docker.settings.context || "default",
  );
  const directory = body.directory ?? (config.settings.directory || DEFAULT_DIRECTORY);
  if (
    typeof directory !== "string" ||
    !/^(\/|~(?:\/|$))/.test(directory.trim()) ||
    directory.includes("\0")
  )
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
  environment?: import("../../../core/modules/environment/index.ts").DockerEnvironment,
  hooks: CloneHooks = {},
) {
  const repository = repositoryName(body.repository);
  await github(`/repos/${repository}`, token);
  const directory = expandPath(base);
  const destination = join(directory, ...repository.split("/"));
  if (imports.has(destination)) throw new HttpError(409, "Этот репозиторий уже импортируется");
  imports.add(destination);
  let staging = "";
  try {
    if ((await loadProjects()).some((project) => project.path === destination))
      throw new HttpError(409, "Проект уже добавлен");
    if (
      await lstat(destination).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      })
    )
      throw new HttpError(
        409,
        "Папка уже существует. Добавьте её как локальный проект или выберите другую папку импорта",
      );
    const parent = join(directory, repository.split("/")[0]);
    await mkdir(parent, { recursive: true });
    staging = await mkdtemp(join(parent, ".projector-import-"));
    const checkout = join(staging, "checkout");
    hooks.signal?.throwIfAborted();
    hooks.phase?.("cloning");
    if (environment)
      await cloneGithubContainer(repository, staging, token, environment, hooks.signal);
    else await cloneGithubRepository(repository, checkout, token, hooks.signal);
    hooks.signal?.throwIfAborted();
    hooks.phase?.("finishing");
    let draft;
    if (await lstat(join(checkout, "package.json")).catch(() => null)) {
      draft = await inspectProject(checkout);
      draft.icon = draft.icon ? draft.icon.replace(checkout, destination) : "";
    } else {
      const command = { id: randomUUID(), name: "git status", cmd: "git status" };
      draft = {
        name: repository.split("/")[1],
        url: "",
        icon: "",
        mode: "server" as const,
        commands: [command],
        defaultCommandId: command.id,
      };
    }
    // Claim the destination atomically, including against another Projector process.
    try {
      await mkdir(destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new HttpError(409, "Папка уже существует");
      throw error;
    }
    try {
      await rename(checkout, destination);
    } catch (error) {
      await rmdir(destination).catch(() => {});
      throw error;
    }
    const project: Project = {
      ...draft,
      path: await realpath(destination),
      environment,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    await updateProjects((projects) => {
      projects.unshift(project);
    });
    return { project };
  } finally {
    imports.delete(destination);
    if (staging) await rm(staging, { recursive: true, force: true });
  }
}
