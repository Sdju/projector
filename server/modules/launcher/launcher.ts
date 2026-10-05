import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { os } from "../../../core/modules/os/index.ts";
import { loadProjects } from "../projects/index.ts";
import { getSnapshot, startProject } from "../processes/index.ts";
import { openBrowser, openWindow } from "../window/index.ts";
import { desktopArgs } from "../window/index.ts";
import { type LaunchItem } from "../../../core/modules/launcher/index.ts";
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
    ...apps,
    ...projects.map((project): LaunchItem => ({
      id: `project:${project.id}`,
      name: project.name,
      kind: "project",
      description: `проект · ${project.commands.find((c) => c.id === project.defaultCommandId)?.name ?? "запуск"}`,
      keywords: project.path,
      icon: `/api/projects/${encodeURIComponent(project.id)}/icon`,
    })),
  ];
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
      .slice(0, 7)
      .map((row) => row.item),
    warning,
  };
}

export async function launchItem(id: string): Promise<void> {
  if (id.startsWith("app:")) {
    const app = (await applications()).find((item) => item.id === id);
    if (!app) throw new Error("Приложение больше не доступно");
    await execute(process.execPath, [...desktopArgs(), "launch", id.slice(4)], { timeout: 10000 });
  } else if (id.startsWith("project:")) {
    const project = (await loadProjects()).find((p) => `project:${p.id}` === id);
    if (!project) throw new Error("Проект не найден");
    const runtime = getSnapshot(project.id);
    if (runtime.status === "running" || runtime.status === "starting") {
      const url = runtime.url || project.url;
      if (!url) throw new Error("Проект запускается; адрес пока недоступен");
      if (project.mode === "window") openWindow(url);
      else openBrowser(url);
    } else startProject(project);
  } else throw new Error("Неизвестный результат поиска");
  await updatePreferences((value) => {
    const usage = value.usage[id];
    value.usage[id] = { count: (usage?.count ?? 0) + 1, last: Date.now() };
  });
}

export async function applicationIcon(id: string): Promise<string | null> {
  const { stdout } = await execute(process.execPath, [...desktopArgs(), "icon", id], {
    timeout: 5000,
  });
  return stdout.trim() || null;
}
