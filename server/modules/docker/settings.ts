import { realpath, stat } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { os } from "../../../core/modules/os/index.ts";
import type { DockerBinding, DockerContext } from "../../../core/modules/docker/index.ts";
import { integrationConfig, updateIntegration } from "../integration-store/index.ts";
import { HttpError } from "../http/index.ts";

export async function dockerContexts(): Promise<DockerContext[]> {
  const { stdout } = await os.tools.runDocker(["context", "ls", "--format", "{{json .}}"]);
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const item = JSON.parse(line);
      return {
        name: item.Name,
        endpoint: item.DockerEndpoint,
        local: String(item.DockerEndpoint).startsWith("unix://"),
      };
    });
}
export async function dockerSettings() {
  const config = await integrationConfig("docker");
  return { enabled: config.enabled, context: config.settings.context || "default" };
}
export async function configureDocker(input: Record<string, unknown>) {
  if (typeof input.enabled !== "boolean" || typeof input.context !== "string")
    throw new HttpError(400, "Укажите enabled и Docker context");
  if (input.enabled) {
    const contexts = await dockerContexts();
    if (!contexts.some((item) => item.name === input.context && item.local))
      throw new HttpError(400, "Выберите локальный Docker context (Unix socket)");
  }
  await updateIntegration("docker", (config) => ({
    ...config,
    enabled: input.enabled as boolean,
    settings: { ...config.settings, context: input.context as string },
  }));
  return dockerSettings();
}
export async function requireContext(context: string) {
  const settings = await dockerSettings();
  if (!settings.enabled) throw new HttpError(409, "Включите Docker в настройках интеграций");
  if (!(await dockerContexts()).some((item) => item.name === context && item.local))
    throw new HttpError(400, "Доступен только локальный Docker context");
  return ["--context", context];
}
export async function readBinding(projectId: string): Promise<DockerBinding | null> {
  const config = await integrationConfig("docker");
  const raw = config.settings[`project:${projectId}`];
  return raw ? JSON.parse(raw) : null;
}
export async function detectedComposeFiles(path: string) {
  const found: string[] = [];
  for (const name of ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"])
    try {
      if ((await stat(resolve(path, name))).isFile()) found.push(name);
    } catch {
      /* Absent. */
    }
  return found;
}
function strings(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    value.some(
      (item) => typeof item !== "string" || !item || item.includes("\0") || item.length > 1024,
    )
  )
    throw new HttpError(400, `${field}: ожидается список непустых строк`);
  return value;
}
export async function projectFile(path: string, name: string) {
  const root = await realpath(path);
  const file = await realpath(resolve(root, name));
  const rel = relative(root, file);
  if (
    !rel ||
    rel === ".." ||
    rel.startsWith("../") ||
    isAbsolute(rel) ||
    !(await stat(file)).isFile()
  )
    throw new HttpError(400, "Compose и env-файлы должны находиться внутри проекта");
  return file;
}
export async function bindDocker(projectId: string, path: string, input: Record<string, unknown>) {
  if (input.binding === null) {
    await updateIntegration("docker", (config) => {
      const settings = { ...config.settings };
      delete settings[`project:${projectId}`];
      return { ...config, settings };
    });
    return null;
  }
  if (
    typeof input.context !== "string" ||
    typeof input.name !== "string" ||
    !/^[a-z0-9][a-z0-9_-]*$/.test(input.name)
  )
    throw new HttpError(400, "Имя Compose: строчные буквы, цифры, дефис и подчёркивание");
  await requireContext(input.context);
  const binding: DockerBinding = {
    context: input.context,
    name: input.name,
    files: strings(input.files, "files"),
    profiles: strings(input.profiles ?? [], "profiles"),
    envFiles: strings(input.envFiles ?? [], "envFiles"),
  };
  if (!binding.files.length) throw new HttpError(400, "Выберите Compose-файл");
  if (binding.profiles.some((profile) => !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(profile)))
    throw new HttpError(400, "Некорректное имя profile");
  for (const file of [...binding.files, ...binding.envFiles]) await projectFile(path, file);
  await updateIntegration("docker", (config) => ({
    ...config,
    settings: { ...config.settings, [`project:${projectId}`]: JSON.stringify(binding) },
  }));
  return binding;
}

/** Entry for the settings overview; live daemon health is owned by the snapshot. */
export async function dockerIntegrationStatus() {
  const config = await integrationConfig("docker");
  return {
    id: "docker",
    name: "Docker",
    description: "Локальные контейнеры и Compose-окружения",
    enabled: config.enabled,
    settings: { context: config.settings.context || "default" },
  };
}
