import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { findFavicon } from "./favicon.ts";
import { expandPath } from "./inspect.ts";

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

export async function listDirectory(path: string): Promise<unknown> {
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
