import type { LaunchItem, LaunchSection } from "@projector-ai/core/modules/launcher/index.ts";

const RECENT_LIMIT = 5;
const PROJECT_LIMIT = 30;
const DISK_LIMIT = 15;
const APP_LIMIT = 6;

/** Empty query: running projects, recent items, remaining projects, unregistered folders, frequent apps. */
export function browse(
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
  const byFolder = (a: LaunchItem, b: LaunchItem) =>
    Number(!!b.folder) - Number(!!a.folder) || byName(a, b);
  return [
    ...take("favorites", items.filter((item) => item.favorite).sort(byRecent)),
    ...take(
      "running",
      projects.filter((item) => item.status && item.status.state !== "error").sort(byRecent),
    ),
    ...take("recent", items.filter((item) => usage[item.id]).sort(byRecent), RECENT_LIMIT),
    ...take("projects", projects.sort(byFolder), PROJECT_LIMIT),
    ...take(
      "disk",
      items.filter((item) => item.kind === "directory"),
      DISK_LIMIT,
    ),
    ...take("apps", apps.sort(byFrequency), APP_LIMIT),
  ];
}
