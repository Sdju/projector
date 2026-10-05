/** Префикс запроса сужает область поиска: `/` — проекты, `gh/` — репозитории GitHub. */
export type LaunchScope = "all" | "projects" | "github";
export interface ParsedQuery {
  scope: LaunchScope;
  text: string;
}
export const launchScopeTitles: Record<Exclude<LaunchScope, "all">, string> = {
  projects: "Проекты",
  github: "GitHub",
};

export function parseLaunchQuery(raw: string): ParsedQuery {
  const query = raw.trimStart();
  if (/^gh\//i.test(query)) return { scope: "github", text: query.slice(3).trim() };
  if (query.startsWith("/")) return { scope: "projects", text: query.slice(1).trim() };
  return { scope: "all", text: raw.trim() };
}
