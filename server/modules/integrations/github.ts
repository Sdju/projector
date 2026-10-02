import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, writeFile, rm, rename, lstat, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { os } from "../../../core/modules/os/index.ts";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { integrationConfig, updateIntegration } from "./store.ts";
import { HttpError } from "../http/index.ts";
import { expandPath, inspectProject } from "../projects/index.ts";
import { loadProjects, updateProjects } from "../projects/index.ts";
import type { Project } from "../projects/index.ts";

const exec = promisify(execFile);
const DEFAULT_DIRECTORY = join(os.homeDirectory(), "Projects");
interface DeviceSession {
  id: string;
  code: string;
  clientId: string;
  expiresAt: number;
  interval: number;
  nextPoll: number;
}
const sessions = new Map<string, DeviceSession>();
const imports = new Set<string>();
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
export function repositoryName(value: unknown): string {
  const name = text(value)
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
  if (
    !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(name) ||
    [".", ".."].includes(name.split("/")[1])
  )
    throw new HttpError(400, "Укажите owner/repository или ссылку github.com");
  return name;
}
async function github<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Projector",
    },
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  if (!response.ok)
    throw new HttpError(
      response.status === 401 ? 401 : response.status === 404 ? 404 : 400,
      response.status === 401
        ? "Авторизация GitHub истекла. Войдите снова"
        : response.status === 404
          ? "Репозиторий не найден или нет доступа"
          : `GitHub вернул ${response.status}. Проверьте права доступа и лимит API`,
    );
  return (await response.json()) as T;
}
async function oauth(path: string, body: Record<string, string>): Promise<Record<string, any>> {
  const response = await fetch(`https://github.com/login/${path}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  if (!response.ok) throw new HttpError(400, `GitHub OAuth вернул ${response.status}`);
  return await response.json();
}
async function authorized() {
  const config = await integrationConfig("github");
  if (!config.enabled) throw new HttpError(400, "Включите интеграцию GitHub в настройках");
  if (!config.credentials.token)
    throw new HttpError(401, "Войдите в GitHub в настройках интеграции");
  return config;
}
export async function githubStatus() {
  const config = await integrationConfig("github");
  return {
    id: "github",
    name: "GitHub",
    description: "Импорт репозиториев в локальный каталог проектов",
    enabled: config.enabled,
    settings: {
      clientId: config.settings.clientId ?? "",
      directory: config.settings.directory || DEFAULT_DIRECTORY,
    },
    connected: !!config.credentials.token,
    account: config.credentials.login || null,
  };
}
export async function configureGithub(body: Record<string, unknown>) {
  if (typeof body.enabled !== "boolean") throw new HttpError(400, "Укажите состояние интеграции");
  const directory = text(body.directory);
  if (!directory) throw new HttpError(400, "Укажите папку для импорта");
  const clientId = text(body.clientId);
  await updateIntegration("github", (config) => ({
    ...config,
    enabled: body.enabled as boolean,
    settings: { clientId, directory: expandPath(directory) },
  }));
  sessions.clear();
  return githubStatus();
}
async function connect(token: string, expectedClientId?: string, sessionId?: string) {
  if (!token || /[\r\n]/.test(token)) throw new HttpError(400, "Укажите корректный токен GitHub");
  const account = await github<{ login: string }>("/user", token);
  await updateIntegration("github", (config) => {
    if (
      (sessionId && !sessions.has(sessionId)) ||
      !config.enabled ||
      (expectedClientId !== undefined && config.settings.clientId !== expectedClientId)
    )
      throw new HttpError(400, "Настройки изменились. Начните авторизацию заново");
    return { ...config, credentials: { token, login: account.login } };
  });
  sessions.clear();
  return githubStatus();
}
export async function connectGithub(body: Record<string, unknown>) {
  return connect(text(body.token));
}
export async function disconnectGithub() {
  sessions.clear();
  await updateIntegration("github", (config) => ({ ...config, credentials: {} }));
  return githubStatus();
}
export async function beginGithubLogin() {
  const config = await integrationConfig("github");
  if (!config.enabled || !config.settings.clientId)
    throw new HttpError(400, "Включите GitHub и сохраните Client ID OAuth App с Device Flow");
  const data = await oauth("device/code", { client_id: config.settings.clientId, scope: "repo" });
  if (
    data.error ||
    !data.device_code ||
    !data.user_code ||
    data.verification_uri !== "https://github.com/login/device"
  )
    throw new HttpError(
      400,
      "Не удалось начать вход. Проверьте Client ID и включение Device Flow в OAuth App",
    );
  sessions.clear();
  const session = {
    id: randomUUID(),
    code: data.device_code,
    clientId: config.settings.clientId,
    expiresAt: Date.now() + Number(data.expires_in) * 1000,
    interval: Number(data.interval) || 5,
    nextPoll: 0,
  };
  session.nextPoll = Date.now() + session.interval * 1000;
  sessions.set(session.id, session);
  return {
    id: session.id,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresAt: session.expiresAt,
    interval: session.interval,
  };
}
export async function pollGithubLogin(body: Record<string, unknown>) {
  const session = sessions.get(text(body.id));
  if (!session || session.expiresAt <= Date.now()) {
    if (session) sessions.delete(session.id);
    throw new HttpError(400, "Код входа истёк. Начните авторизацию заново");
  }
  if (Date.now() < session.nextPoll)
    return {
      pending: true,
      interval: Math.max(1, Math.ceil((session.nextPoll - Date.now()) / 1000)),
    };
  session.nextPoll = Date.now() + 30_000;
  const data = await oauth("oauth/access_token", {
    client_id: session.clientId,
    device_code: session.code,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });
  if (sessions.get(session.id) !== session) throw new HttpError(400, "Авторизация отменена");
  if (data.error === "authorization_pending" || data.error === "slow_down") {
    if (data.error === "slow_down") session.interval += 5;
    session.nextPoll = Date.now() + session.interval * 1000;
    return { pending: true, interval: session.interval };
  }
  if (!data.access_token) {
    sessions.delete(session.id);
  }
  if (!data.access_token)
    throw new HttpError(
      400,
      data.error === "access_denied"
        ? "Вход отменён в GitHub"
        : "Не удалось завершить вход. Попробуйте снова",
    );
  return {
    pending: false,
    integration: await connect(data.access_token, session.clientId, session.id),
  };
}
export async function githubRepositories(page: number) {
  const config = await authorized();
  if (!Number.isInteger(page) || page < 1 || page > 1000)
    throw new HttpError(400, "Неверная страница");
  const repos = await github<
    Array<{ full_name: string; description: string; private: boolean; html_url: string }>
  >(
    `/user/repos?per_page=50&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
    config.credentials.token,
  );
  return {
    repositories: repos.map((repo) => ({
      fullName: repo.full_name,
      description: repo.description,
      private: repo.private,
      url: repo.html_url,
    })),
    page,
    hasMore: repos.length === 50,
  };
}
export async function cloneGithubRepository(
  repository: string,
  destination: string,
  token: string,
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
      },
    );
  } catch {
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
  const repository = repositoryName(body.repository);
  await github(`/repos/${repository}`, config.credentials.token);
  const directory = expandPath(config.settings.directory || DEFAULT_DIRECTORY);
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
    await cloneGithubRepository(repository, checkout, config.credentials.token);
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
      path: destination,
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
