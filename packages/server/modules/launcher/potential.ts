import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { sameLocalPath, type Project } from "../projects/index.ts";
import type { LaunchItem } from "@projector/core/modules/launcher/index.ts";
import { isDirectory } from "./folders.ts";
import { tildePath } from "./project-entries.ts";

/** Direct children that are never a project the user would open from a favorite folder. */
const SKIP = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "venv",
  "target",
  "__pycache__",
]);

export const potentialId = (path: string) => `potential:${path}`;

export const parsePotentialId = (id: string) => id.slice(10);

/**
 * Unregistered direct children of favorite folders. Hidden names and well-known junk
 * directories are skipped; anything else can be opened as a project.
 */
export async function potentialItems(
  folders: string[],
  projects: Project[],
): Promise<LaunchItem[]> {
  const groups: LaunchItem[][] = [];
  for (const folder of folders) {
    if (!(await isDirectory(folder))) continue;
    const group: LaunchItem[] = [];
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
      // Regular files are the overwhelming majority; the dirent already says so, and a
      // stat per entry makes a home-sized favorite folder crawl.
      if (entry.isFile()) continue;
      const path = join(folder, entry.name);
      if (!entry.isDirectory() && !(await isDirectory(path))) continue;
      if (projects.some((project) => sameLocalPath(project.path, path))) continue;
      group.push({
        id: potentialId(path),
        name: entry.name,
        kind: "directory",
        description: `на диске · ${tildePath(folder)}`,
        keywords: path,
        folder: true,
        actions: [{ id: "open", title: "Открыть" }],
      });
    }
    group.sort((a, b) => a.name.localeCompare(b.name));
    if (group.length) groups.push(group);
  }
  const items: LaunchItem[] = [];
  for (let index = 0; ; index++) {
    let added = false;
    for (const group of groups) {
      const item = group[index];
      if (!item) continue;
      items.push(item);
      added = true;
    }
    if (!added) break;
  }
  return items;
}
