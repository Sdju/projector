import { isAbsolute, relative, sep } from "node:path";
import { os } from "../../../core/modules/os/index.ts";
import { loadProjects } from "../projects/index.ts";
import { getSnapshot, processOutput } from "../processes/index.ts";
import { preferences } from "../preferences/index.ts";
import type {
  LaunchAction,
  LaunchDetail,
  LaunchInfo,
  LaunchItem,
} from "../../../core/modules/launcher/index.ts";
import { githubProjectRoute } from "../../../core/modules/github/index.ts";
import { parseProjectRef, pathToUrlSegments } from "../../../core/modules/project/index.ts";
import type { Project } from "../../../core/modules/project/index.ts";

/** Mirrors the client `projectRoute`: the workspace URL of a project path. */
export function workspaceRoute(path: string): string {
  const ref = parseProjectRef(path);
  if (ref.kind === "github") return githubProjectRoute(ref.repository);
  const segments = pathToUrlSegments(path).map((segment) =>
    encodeURIComponent(segment).replaceAll("%3A", ":"),
  );
  return `/projects/${segments.length ? segments.join("/") : "%2F"}`;
}

export function projectItem(project: Project): LaunchItem {
  const command = project.commands.find((c) => c.id === project.defaultCommandId);
  const state = getSnapshot(project.id).status;
  const running = state === "running" || state === "starting";
  return {
    id: `project:${project.id}`,
    name: project.name,
    kind: "project",
    description: `проект · ${running ? "работает" : state === "stopping" ? "останавливается" : state === "error" ? "ошибка запуска" : (command?.name ?? "без команды")}`,
    status: running
      ? { state, label: state === "starting" ? "запускается" : "работает" }
      : state === "stopping"
        ? { state, label: "останавливается" }
        : state === "error"
          ? { state, label: "ошибка запуска" }
          : undefined,
    keywords: project.path,
    icon: `/api/projects/${encodeURIComponent(project.id)}/icon`,
    actions: [
      { id: "open", title: "Открыть" },
      ...(command || running
        ? [
            {
              id: "run" as const,
              title: running ? "Открыть запущенный" : `Запустить ${command!.name}`,
            },
          ]
        : []),
      ...(running ? [{ id: "stop" as const, title: "Остановить" }] : []),
    ],
  };
}

const STATE_LABELS: Record<LaunchInfo["state"], string> = {
  idle: "остановлен",
  starting: "запускается",
  running: "работает",
  stopping: "останавливается",
  error: "ошибка запуска",
};
const tildePath = (path: string) => {
  const home = os.homeDirectory();
  if (path === home) return "~";
  const rel = relative(home, path);
  // Windows paths use backslashes, but the shown form is always `~/…`.
  return rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
    ? `~/${rel.split(sep).join("/")}`
    : path;
};

async function favoriteAction(id: string): Promise<LaunchAction> {
  const favorite = (await preferences()).favorites.includes(id);
  return { id: "favorite", title: favorite ? "Убрать из избранного" : "Добавить в избранное" };
}

export async function launchDetail(id: string): Promise<LaunchDetail> {
  if (!id.startsWith("project:")) {
    if (id.startsWith("gh:")) return { actions: [{ id: "open", title: "Открыть репозиторий" }] };
    if (id.startsWith("gl:"))
      return { actions: [{ id: "import", title: "Клонировать и открыть" }] };
    return { actions: [{ id: "launch", title: "Запустить" }, await favoriteAction(id)] };
  }
  const project = (await loadProjects()).find((p) => `project:${p.id}` === id);
  if (!project) throw new Error("Проект не найден");
  const runtime = getSnapshot(project.id);
  const running = runtime.status === "running" || runtime.status === "starting";
  const commands = [
    ...project.commands.filter((command) => command.id === project.defaultCommandId),
    ...project.commands.filter((command) => command.id !== project.defaultCommandId),
  ];
  const actions: LaunchAction[] = [{ id: "open", title: "Открыть воркспейс" }];
  if (running)
    actions.push(
      { id: "browser", title: "Открыть в браузере" },
      { id: "window", title: "Открыть в окне" },
      { id: "stop", title: "Остановить" },
    );
  else if (runtime.status !== "stopping") {
    actions.push(
      ...commands.map((command) => ({
        id: "run" as const,
        title: `Запустить ${command.name}`,
        arg: command.id,
      })),
    );
    if (commands[0])
      actions.push({
        id: "window",
        title: `Запустить ${commands[0].name} в окне`,
        arg: commands[0].id,
      });
  }
  actions.push(await favoriteAction(id));
  const info: LaunchInfo = {
    path: tildePath(project.path),
    state: runtime.status,
    stateLabel: STATE_LABELS[runtime.status],
    command: runtime.commandName ?? undefined,
    url:
      running || runtime.status === "stopping"
        ? (runtime.url ?? project.url) || undefined
        : undefined,
    docker: project.environment
      ? `Docker · ${project.environment.image} · сеть: ${project.environment.network}`
      : undefined,
  };
  const detail: LaunchDetail = { actions, info };
  if (runtime.status === "error")
    detail.failure = {
      command: runtime.commandName ?? "команда",
      exitCode: runtime.exitCode,
      output: processOutput(project.id) ?? "",
    };
  return detail;
}
