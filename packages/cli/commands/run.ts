import { writeJson, type Output } from "../common/output.ts";
import type { CliOptions } from "../modules/arguments/index.ts";
import type { ProjectorApi } from "../modules/api/index.ts";
import type { ProjectRunResult } from "../modules/command-runtime/index.ts";
import { resolveProject } from "../modules/projects/index.ts";

export async function commandRun(
  api: ProjectorApi,
  options: CliOptions,
  target: string | undefined,
  out: Output,
): Promise<ProjectRunResult> {
  const project = await resolveProject(api, target);
  if (options.command && !project.commands.some((command) => command.id === options.command))
    throw new Error(`Команда не найдена: ${options.command}`);
  const body = options.command ? { commandId: options.command } : {};
  const { runtime } = await api.start(project.id, body);
  const result: ProjectRunResult = {
    project: { id: project.id, name: project.name, path: project.path },
    runtime,
  };
  if (options.json) writeJson(out, result);
  else if (!options.quiet) {
    out(`Запущен ${project.name}: ${runtime.commandName ?? "команда"}`);
    if (runtime.pid) out(`PID: ${runtime.pid}`);
    if (runtime.url) out(`Адрес: ${runtime.url}`);
  }
  if (runtime.status === "error")
    throw new Error(`Команда завершилась с ошибкой (код ${runtime.exitCode ?? "?"})`);
  return result;
}

export async function commandStop(
  api: ProjectorApi,
  options: CliOptions,
  target: string | undefined,
  out: Output,
): Promise<ProjectRunResult> {
  const project = await resolveProject(api, target);
  const result: ProjectRunResult = {
    project: { id: project.id, name: project.name, path: project.path },
    runtime: (await api.stop(project.id)).runtime,
  };
  if (options.json) writeJson(out, result);
  else if (!options.quiet)
    out(
      result.runtime.status === "idle"
        ? `${project.name}: уже остановлен`
        : `${project.name}: остановка запущена`,
    );
  return result;
}
