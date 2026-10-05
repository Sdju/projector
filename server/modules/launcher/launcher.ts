import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { os } from "../../../core/modules/os/index.ts";
import { loadProjects } from "../projects/index.ts";
import { getSnapshot, startProject, stopProject } from "../processes/index.ts";
import { openBrowser, openWindow } from "../window/index.ts";
import { desktopArgs } from "../window/index.ts";
import type {
  LaunchActionId,
  LaunchItem,
  LaunchResult,
  LaunchSection,
} from "../../../core/modules/launcher/index.ts";
import { appUrl } from "../../../core/modules/app-paths/index.ts";
import { githubProjectRoute } from "../../../core/modules/github/index.ts";
import { parseProjectRef, pathToUrlSegments } from "../../../core/modules/project/index.ts";
import type { Project } from "../../../core/modules/project/index.ts";
export {
  shortcuts,
  type LaunchItem,
  type InterfaceMode,
} from "../../../core/modules/launcher/index.ts";

const execute = promisify(execFile);
import { preferences, updatePreferences } from "../preferences/index.ts";
export { preferences, interfaceMode, saveInterface } from "../preferences/index.ts";
export async function shortcutStatus(): Promise<{
  supported: boolean;
  active: boolean;
  shortcut: string;
}> {
  try {
    const { stdout } = await execute(process.execPath, [...desktopArgs(), "shortcut-status"], {
      timeout: 8000,
    });
    return JSON.parse(stdout);
  } catch {
    return { supported: false, active: false, shortcut: "" };
  }
}

export async function checkShortcut(shortcut: string): Promise<void> {
  if (!shortcut) return;
  try {
    const { stdout } = await execute(
      process.execPath,
      [...desktopArgs(), "shortcut-check", shortcut],
      { timeout: 8000 },
    );
    const result = JSON.parse(stdout);
    if (result.supported && !result.available)
      throw new Error(`Сочетание ${shortcut} уже занято другим приложением`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("уже занято")) throw error;
  }
}

let catalog: { at: number; items: LaunchItem[] } | undefined;
let catalogLoading: Promise<LaunchItem[]> | undefined;
async function applications(): Promise<LaunchItem[]> {
  if (catalog && Date.now() - catalog.at < 15000) return catalog.items;
  if (catalogLoading) return catalogLoading;
  catalogLoading = execute(process.execPath, [...desktopArgs(), "list"], {
    timeout: 10000,
    maxBuffer: 4 * 1024 * 1024,
  })
    .then(({ stdout }) => {
      const items = JSON.parse(stdout) as LaunchItem[];
      catalog = { at: Date.now(), items };
      return items;
    })
    .finally(() => {
      catalogLoading = undefined;
    });
  return catalogLoading;
}

const normalize = (value: string) =>
  value.toLocaleLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
export function matchScore(item: LaunchItem, query: string): number {
  const name = normalize(item.name);
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return 0;
  const haystack = normalize(`${item.name} ${item.keywords} ${item.description}`);
  let score = 0;
  for (const term of terms) {
    if (name === term) score += 120;
    else if (name.startsWith(term)) score += 90;
    else if (name.includes(term)) score += 70;
    else if (haystack.includes(term)) score += 40;
    else {
      let cursor = 0;
      let start = -1;
      let end = 0;
      for (let i = 0; i < name.length && cursor < term.length; i++) {
        if (name[i] === term[cursor]) {
          if (start < 0) start = i;
          end = i;
          cursor++;
        }
      }
      if (cursor !== term.length) return -1;
      score += Math.max(1, 25 - (end - start - term.length + 1));
    }
  }
  return score;
}

/** Mirrors the client `projectRoute`: the workspace URL of a project path. */
export function workspaceRoute(path: string): string {
  const ref = parseProjectRef(path);
  if (ref.kind === "github") return githubProjectRoute(ref.repository);
  const segments = pathToUrlSegments(path).map((segment) =>
    encodeURIComponent(segment).replaceAll("%3A", ":"),
  );
  return `/projects/${segments.length ? segments.join("/") : "%2F"}`;
}

function projectItem(project: Project): LaunchItem {
  const command = project.commands.find((c) => c.id === project.defaultCommandId);
  const state = getSnapshot(project.id).status;
  const running = state === "running" || state === "starting";
  return {
    id: `project:${project.id}`,
    name: project.name,
    kind: "project",
    description: `проект · ${running ? "работает" : (command?.name ?? "без команды")}`,
    status: running
      ? { state, label: state === "starting" ? "запускается" : "работает" }
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

export async function searchLauncher(
  query: string,
): Promise<{ items: LaunchItem[]; warning?: string }> {
  let warning: string | undefined;
  const [apps, projects, prefs] = await Promise.all([
    applications().catch(() => {
      warning =
        os.platform === "win32"
          ? "Системные приложения недоступны."
          : "Системные приложения недоступны. Проверьте node-gtk и системные библиотеки GIO.";
      return [];
    }),
    loadProjects(),
    preferences(),
  ]);
  const items: LaunchItem[] = [
    ...apps.map((app): LaunchItem => ({ ...app, actions: [{ id: "launch", title: "Запустить" }] })),
    ...projects.map(projectItem),
  ];
  if (!query.trim()) return { items: browse(items, prefs.usage), warning };
  const ranked = items.map((item) => ({
    item,
    score: matchScore(item, query),
    usage: prefs.usage[item.id],
  }));
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      (b.usage?.count ?? 0) - (a.usage?.count ?? 0) ||
      (b.usage?.last ?? 0) - (a.usage?.last ?? 0) ||
      a.item.name.localeCompare(b.item.name),
  );
  return {
    items: ranked
      .filter((row) => row.score >= 0)
      .slice(0, 10)
      .map((row) => row.item),
    warning,
  };
}

const RECENT_LIMIT = 5;
const PROJECT_LIMIT = 30;
const APP_LIMIT = 6;

/** Empty query: running projects, recent items, the remaining projects, frequent applications. */
function browse(
  items: LaunchItem[],
  usage: Record<string, { count: number; last: number } | undefined>,
): LaunchItem[] {
  const placed = new Set<string>();
  const take = (section: LaunchSection, list: LaunchItem[], limit = Infinity) =>
    list
      .filter((item) => !placed.has(item.id))
      .slice(0, limit)
      .map((item) => {
        placed.add(item.id);
        return { ...item, section };
      });
  const byName = (a: LaunchItem, b: LaunchItem) => a.name.localeCompare(b.name);
  const byRecent = (a: LaunchItem, b: LaunchItem) =>
    (usage[b.id]?.last ?? 0) - (usage[a.id]?.last ?? 0) || byName(a, b);
  const byFrequency = (a: LaunchItem, b: LaunchItem) =>
    (usage[b.id]?.count ?? 0) - (usage[a.id]?.count ?? 0) || byRecent(a, b);
  const projects = items.filter((item) => item.kind === "project");
  const apps = items.filter((item) => item.kind === "application");
  return [
    ...take("running", projects.filter((item) => item.status).sort(byRecent)),
    ...take("recent", items.filter((item) => usage[item.id]).sort(byRecent), RECENT_LIMIT),
    ...take("projects", projects.sort(byName), PROJECT_LIMIT),
    ...take("apps", apps.sort(byFrequency), APP_LIMIT),
  ];
}

export async function launchItem(
  id: string,
  action?: LaunchActionId,
  inline = false,
): Promise<LaunchResult> {
  const result: LaunchResult = { ok: true };
  if (id.startsWith("app:")) {
    if (action && action !== "launch") throw new Error("Для приложения доступен только запуск");
    const app = (await applications()).find((item) => item.id === id);
    if (!app) throw new Error("Приложение больше не доступно");
    await execute(process.execPath, [...desktopArgs(), "launch", id.slice(4)], { timeout: 10000 });
  } else if (id.startsWith("project:")) {
    const project = (await loadProjects()).find((p) => `project:${p.id}` === id);
    if (!project) throw new Error("Проект не найден");
    if (action === "launch") throw new Error("Для проекта доступны открытие, запуск и остановка");
    if (action === "stop") {
      stopProject(project.id);
      return result;
    }
    if (action !== "run") {
      result.route = workspaceRoute(project.path);
      if (!inline) {
        const url = appUrl() + result.route;
        if ((await preferences()).mode === "window") openWindow(url);
        else openBrowser(url);
      }
    } else {
      const runtime = getSnapshot(project.id);
      if (runtime.status === "running" || runtime.status === "starting") {
        const url = runtime.url || project.url;
        if (!url) throw new Error("Проект запускается; адрес пока недоступен");
        if (project.mode === "window") openWindow(url);
        else openBrowser(url);
      } else startProject(project);
    }
  } else throw new Error("Неизвестный результат поиска");
  await updatePreferences((value) => {
    const usage = value.usage[id];
    value.usage[id] = { count: (usage?.count ?? 0) + 1, last: Date.now() };
  });
  return result;
}

export async function applicationIcon(id: string): Promise<string | null> {
  const { stdout } = await execute(process.execPath, [...desktopArgs(), "icon", id], {
    timeout: 5000,
  });
  return stdout.trim() || null;
}
