import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { findFavicon } from "../projects/index.ts";
import { expandPath, inspectProject } from "../projects/index.ts";
import { loadProjects, updateProjects } from "../projects/index.ts";
import type { LaunchMode, Project } from "../projects/index.ts";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".output",
  ".next",
  ".nuxt",
  ".vite",
  "coverage",
  "venv",
  ".venv",
  "target",
  ".turbo",
  ".cache",
]);

const NESTED_SKIP = new Set([
  ...SKIP_DIRS,
  "docs",
  "doc",
  "demo",
  "demos",
  "examples",
  "example",
  "speech",
  "e2e",
  "cypress",
  "tests",
  "test",
  "__tests__",
  "fixtures",
  "templates",
  "template",
  "_template",
  "vendor",
]);

const CONFIG_KIND: [string, string][] = [
  ["vite.config.ts", "vite"],
  ["vite.config.js", "vite"],
  ["vite.config.mts", "vite"],
  ["vite.config.mjs", "vite"],
  ["nuxt.config.ts", "nuxt"],
  ["nuxt.config.js", "nuxt"],
  ["next.config.ts", "next"],
  ["next.config.js", "next"],
  ["next.config.mjs", "next"],
  ["astro.config.mjs", "astro"],
  ["astro.config.ts", "astro"],
];

export interface AgentToolContext {
  onProject: (project: Project) => void;
}

interface FoundApp {
  name: string;
  path: string;
  kind: string;
  score: number;
  app: boolean;
  hasIcon: boolean;
  scripts: string[];
}

function detectKind(names: string[], scripts: Record<string, string>): string {
  for (const [file, kind] of CONFIG_KIND) {
    if (names.includes(file)) return kind;
  }
  const blob = `${Object.keys(scripts).join(" ")} ${Object.values(scripts).join(" ")}`;
  if (/\bnuxt\b/.test(blob)) return "nuxt";
  if (/\bnext\b/.test(blob)) return "next";
  if (/\bastro\b/.test(blob)) return "astro";
  if (/\bvite\b/.test(blob)) return "vite";
  if (names.includes("index.html")) return "vite";
  if (names.includes("pnpm-workspace.yaml") || names.includes("lerna.json")) return "workspace";
  return "node";
}

function scoreHit(
  dir: string,
  kind: string,
  names: string[],
  scripts: Record<string, string>,
  hasIcon: boolean,
): number {
  let score = 0;
  if (kind === "vite" || kind === "nuxt" || kind === "next" || kind === "astro") score += 50;
  if (names.includes("index.html")) score += 20;
  if (scripts.dev || scripts.start) score += 15;
  if (hasIcon) score += 10;
  if (dir.includes("/pr/my/")) score += 8;
  if (dir.includes("/pr/clone/") || dir.includes("/pr/learn/")) score -= 8;
  if (/tutorial|playground|demo|test-|^vitejs-vite-/.test(basename(dir))) score -= 12;
  if (kind === "workspace") score -= 40;
  if (kind === "node" && !scripts.dev && !scripts.start) score -= 20;
  return score;
}

async function analyzeDir(dir: string, names: string[]): Promise<FoundApp> {
  const raw = await readFile(join(dir, "package.json"), "utf8").catch(() => "{}");
  let pkg: { name?: string; scripts?: Record<string, string> } = {};
  try {
    pkg = JSON.parse(raw) as { name?: string; scripts?: Record<string, string> };
  } catch {
    pkg = {};
  }
  const scripts = pkg.scripts ?? {};
  const kind = detectKind(names, scripts);
  const icon = await findFavicon(dir);
  const score = scoreHit(dir, kind, names, scripts, Boolean(icon));
  return {
    name: pkg.name || basename(dir),
    path: dir,
    kind,
    score,
    app: score >= 40 && kind !== "workspace",
    hasIcon: Boolean(icon),
    scripts: Object.keys(scripts).filter((key) =>
      ["dev", "start", "preview", "serve"].includes(key),
    ),
  };
}

async function listDirectory(path: string): Promise<unknown> {
  const root = expandPath(path);
  const entries = await readdir(root, { withFileTypes: true });
  const items = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith(".") && !SKIP_DIRS.has(entry.name))
      .slice(0, 80)
      .map(async (entry) => {
        const full = join(root, entry.name);
        let hasPackage = false;
        if (entry.isDirectory()) {
          const kids = await readdir(full).catch((): string[] => []);
          hasPackage = kids.includes("package.json");
        }
        return {
          name: entry.name,
          path: full,
          type: entry.isDirectory() ? "dir" : "file",
          hasPackageJson: hasPackage,
        };
      }),
  );
  return { path: root, items };
}

export async function findProjects(path: string, depth = 4): Promise<unknown> {
  const root = expandPath(path);
  const found: FoundApp[] = [];

  async function walk(dir: string, level: number): Promise<void> {
    if (found.length >= 80) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch((): Dirent[] => []);
    const names = entries.map((item) => item.name);
    if (names.includes("package.json")) {
      const hit = await analyzeDir(dir, names);
      if (hit.app || hit.score >= 30) found.push(hit);
      if (hit.app) return;
    }
    if (level >= depth) return;
    for (const entry of entries) {
      if (!entry.isDirectory() || NESTED_SKIP.has(entry.name) || entry.name.startsWith(".")) {
        continue;
      }
      await walk(join(dir, entry.name), level + 1);
    }
  }

  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) throw new Error("Папка не найдена");
  await walk(root, 0);

  found.sort((a, b) => b.score - a.score);
  const apps = found.filter((item) => item.app);
  const picked = (apps.length ? apps : found).slice(0, 16);
  return {
    root,
    hint: "Сразу вызови add_projects со списком path у записей app:true. Не вызывай inspect_path.",
    count: picked.length,
    skipped: Math.max(0, found.length - picked.length),
    projects: picked,
  };
}

async function addFromPath(
  path: string,
  overrides: { name?: string; url?: string; mode?: LaunchMode } = {},
): Promise<{ project: Project; created: boolean }> {
  const inspected = await inspectProject(path);
  const project: Project = {
    id: randomUUID(),
    name: overrides.name?.trim() || inspected.name,
    path: inspected.path,
    url: overrides.url?.trim() || inspected.url,
    icon: inspected.icon,
    mode: overrides.mode ?? inspected.mode,
    defaultCommandId: inspected.defaultCommandId,
    commands: inspected.commands,
    createdAt: new Date().toISOString(),
  };
  let result = { project, created: true };
  await updateProjects((projects) => {
    const existing = projects.find((item) => item.path === inspected.path);
    if (existing) result = { project: existing, created: false };
    else projects.push(project);
  });
  return result;
}

export function createAgentTools(context: AgentToolContext) {
  return {
    list_projects: tool({
      description: "Список уже добавленных в projector проектов.",
      inputSchema: z.object({}),
      execute: async () => {
        const projects = await loadProjects();
        return projects.map((item) => ({
          id: item.id,
          name: item.name,
          path: item.path,
          url: item.url,
          icon: item.icon || null,
          commands: item.commands.map((command) => command.name),
        }));
      },
    }),
    list_directory: tool({
      description:
        "Показать содержимое папки. Только если путь неясен. Не используй для обхода всех проектов.",
      inputSchema: z.object({
        path: z.string().describe("Абсолютный путь или ~/..."),
      }),
      execute: async ({ path }) => listDirectory(path),
    }),
    find_projects: tool({
      description:
        "Найти запускаемые приложения (vite/nuxt/next/astro) под корнем. Отсекает packages/, docs/, demo/, speech/ и вложенный мусор. Возвращает уже отсортированный короткий список.",
      inputSchema: z.object({
        path: z.string().describe("Корневая папка поиска"),
        depth: z.number().min(1).max(5).optional().describe("Глубина, по умолчанию 4"),
      }),
      execute: async ({ path, depth }) => findProjects(path, depth ?? 4),
    }),
    inspect_path: tool({
      description:
        "Прочитать один package.json. Не нужно перед add_projects — добавление само читает проект.",
      inputSchema: z.object({
        path: z.string().describe("Путь к проекту"),
      }),
      execute: async ({ path }) => inspectProject(path),
    }),
    add_project: tool({
      description: "Добавить один проект. Для нескольких путей используй add_projects.",
      inputSchema: z.object({
        path: z.string().describe("Путь к проекту"),
        name: z.string().optional().describe("Имя, если нужно переименовать"),
        url: z.string().optional().describe("URL dev-сервера, если известен"),
        mode: z.enum(["server", "window"]).optional(),
      }),
      execute: async ({ path, name, url, mode }) => {
        const { project, created } = await addFromPath(path, { name, url, mode });
        if (created) context.onProject(project);
        return {
          added: created,
          existed: !created,
          id: project.id,
          name: project.name,
          path: project.path,
          url: project.url,
          icon: project.icon || null,
          mode: project.mode,
          commands: project.commands.map((item) => ({ name: item.name, cmd: item.cmd })),
        };
      },
    }),
    add_projects: tool({
      description:
        "Добавить несколько приложений сразу. Сам читает package.json и ищет favicon. Пропускает уже добавленные пути.",
      inputSchema: z.object({
        paths: z.array(z.string()).min(1).max(16).describe("Пути к приложениям из find_projects"),
        mode: z.enum(["server", "window"]).optional(),
      }),
      execute: async ({ paths, mode }) => {
        const added: unknown[] = [];
        const existed: unknown[] = [];
        const errors: unknown[] = [];
        for (const path of paths) {
          try {
            const { project, created } = await addFromPath(path, { mode });
            const row = {
              id: project.id,
              name: project.name,
              path: project.path,
              url: project.url,
            };
            if (created) {
              context.onProject(project);
              added.push(row);
            } else {
              existed.push(row);
            }
          } catch (error) {
            errors.push({
              path,
              error: error instanceof Error ? error.message : "не удалось добавить",
            });
          }
        }
        return { added, existed, errors };
      },
    }),
  };
}

export const AGENT_SYSTEM_PROMPT = `Ты агент Projector. Добавляешь локальные приложения в каталог без ручной формы.

Как работать:
1. Если дан каталог с несколькими проектами — сразу find_projects (depth 4 для /pr и похожих корней).
2. Бери только записи с app:true и высоким score. Пропускай packages, docs, demo, speech, workspace-корни.
3. Сразу add_projects со списком path. Не вызывай inspect_path и list_directory без нужды.
4. Если просят «некоторые / несколько / добавь проекты» — добавь 5–8 лучших из списка, не весь шум.
5. Если путь один и это уже приложение — add_project.
6. Не выдумывай пути. Если папки нет — так и скажи.
7. Режим по умолчанию server. window — только по просьбе.
8. Ответь коротко по-русски: что добавлено, команда запуска, нашлась ли иконка.`;
