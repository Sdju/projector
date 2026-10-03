import { os } from "../../../core/modules/os/index.ts";
import type { DockerAction } from "../../../core/modules/docker/index.ts";
import type { Project } from "../projects/index.ts";
import { createTerminalSession, listTerminalSessions } from "../terminal/index.ts";
import { HttpError } from "../http/index.ts";
import { requireContext, readBinding, projectFile } from "./settings.ts";

const host = globalThis as typeof globalThis & { projectorDockerActions?: Set<string> };
const locks = (host.projectorDockerActions ??= new Set<string>());
const containerActions = new Set(["start", "stop", "restart", "remove", "logs", "shell"]);
const composeActions: Partial<Record<DockerAction, string[]>> = {
  up: ["up", "-d"],
  composeStop: ["stop"],
  composeRestart: ["restart"],
  down: ["down"],
  build: ["build"],
  pull: ["pull"],
};
export async function dockerAction(project: Project, input: Record<string, unknown>) {
  const action = input.action as DockerAction;
  if (!containerActions.has(action) && !composeActions[action])
    throw new HttpError(400, "Неизвестное Docker-действие");
  if (typeof input.context !== "string") throw new HttpError(400, "Укажите Docker context");
  const prefix = await requireContext(input.context);
  if ((action === "remove" || action === "down") && input.confirm !== true)
    throw new HttpError(409, "Подтвердите удаление контейнеров и сетей; volumes сохраняются");
  const key = input.context;
  if (locks.has(key)) throw new HttpError(409, "Дождитесь текущей Docker-операции");
  locks.add(key);
  try {
    let args: string[];
    let containerId: string | undefined;
    let composeProject: string | undefined;
    let title: string;
    if (containerActions.has(action)) {
      if (typeof input.containerId !== "string" || !/^[a-f0-9]{64}$/.test(input.containerId))
        throw new HttpError(400, "Укажите полный containerId");
      const inspected = JSON.parse(
        (await os.tools.runDocker([...prefix, "inspect", "--type", "container", input.containerId]))
          .stdout,
      )[0];
      if (!inspected || inspected.Id !== input.containerId)
        throw new HttpError(404, "Контейнер не найден");
      containerId = inspected.Id;
      if (
        !["logs", "shell"].includes(action) &&
        listTerminalSessions().some(
          (session) =>
            session.status === "running" &&
            session.docker?.context === input.context &&
            session.docker?.containerId === containerId &&
            !["logs", "shell"].includes(session.docker?.kind ?? ""),
        )
      )
        throw new HttpError(409, "Дождитесь операции над этим контейнером");
      if (action === "shell" && !inspected.State?.Running)
        throw new HttpError(409, "Контейнер должен работать");
      if (action === "remove" && inspected.State?.Running)
        throw new HttpError(409, "Сначала остановите контейнер");
      if (
        action === "shell" &&
        input.shell !== undefined &&
        input.shell !== "sh" &&
        input.shell !== "bash"
      )
        throw new HttpError(400, "shell: sh или bash");
      args =
        action === "logs"
          ? ["logs", "--follow", "--tail", "200", "--timestamps", containerId!]
          : action === "shell"
            ? ["exec", "-it", containerId!, (input.shell as string) || "sh"]
            : [
                action === "remove" ? "rm" : action,
                ...(action === "stop" || action === "restart" ? ["--time", "10"] : []),
                containerId!,
              ];
      title = `Docker ${action} · ${String(inspected.Name).replace(/^\//, "")}`;
    } else {
      const binding = await readBinding(project.id);
      if (!binding || binding.context !== input.context)
        throw new HttpError(409, "Привяжите Compose к проекту и выбранному context");
      composeProject = binding.name;
      args = ["compose", "--project-directory", project.path, "--project-name", binding.name];
      for (const file of binding.files) args.push("-f", await projectFile(project.path, file));
      for (const file of binding.envFiles)
        args.push("--env-file", await projectFile(project.path, file));
      for (const profile of binding.profiles) args.push("--profile", profile);
      if (
        listTerminalSessions().some(
          (session) =>
            session.status === "running" &&
            session.docker?.context === input.context &&
            session.docker?.composeProject === binding.name,
        )
      )
        throw new HttpError(409, "Дождитесь текущей Compose-операции");
      args.push(...composeActions[action]!);
      if (input.service !== undefined) {
        if (
          typeof input.service !== "string" ||
          !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(input.service) ||
          action === "down"
        )
          throw new HttpError(400, "Некорректный Compose service");
        args.push(input.service);
      }
      title = `Compose ${action} · ${binding.name}`;
    }
    // Reuse PTY flow control, reconnect snapshots, exit status and dock tabs.
    const session = createTerminalSession(project, { program: "shell" }, undefined, undefined, {
      file: "docker",
      args: [...prefix, ...args],
      title,
      docker: { context: input.context, kind: action, containerId, composeProject },
    });
    return { session };
  } finally {
    locks.delete(key);
  }
}
export async function dockerLogs(context: string, containerId: string) {
  const prefix = await requireContext(context);
  if (!/^[a-f0-9]{64}$/.test(containerId)) throw new HttpError(400, "Укажите полный containerId");
  const result = await os.tools.runDocker([
    ...prefix,
    "logs",
    "--tail",
    "200",
    "--timestamps",
    containerId,
  ]);
  return { text: result.stdout + result.stderr };
}
