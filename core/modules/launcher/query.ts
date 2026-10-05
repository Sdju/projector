/**
 * Префикс запроса сужает область поиска: `/` — проекты, `gh/` — репозитории GitHub.
 * Ссылка `https://github.com/owner/repo` равна `gh/owner/repo`.
 */
export type LaunchScope = "all" | "projects" | "github";
export interface ParsedQuery {
  scope: LaunchScope;
  text: string;
}
export const launchScopeTitles: Record<Exclude<LaunchScope, "all">, string> = {
  projects: "Проекты",
  github: "GitHub",
};

const GITHUB_URL = /^https?:\/\/(?:www\.)?github\.com(?:\/|$)/i;

/** `owner/repo/tree/main?x#y` → `owner/repo`; one segment → `owner/` (list that owner). */
function githubUrlText(rest: string): string {
  const [owner = "", repo = ""] = rest.split(/[?#]/)[0].split("/").filter(Boolean);
  if (!owner) return "";
  return repo ? `${owner}/${repo.replace(/\.git$/i, "")}` : `${owner}/`;
}

export function parseLaunchQuery(raw: string): ParsedQuery {
  const query = raw.trimStart();
  const url = GITHUB_URL.exec(query);
  if (url) return { scope: "github", text: githubUrlText(query.slice(url[0].length)) };
  if (/^gh\//i.test(query)) return { scope: "github", text: query.slice(3).trim() };
  if (query.startsWith("/")) return { scope: "projects", text: query.slice(1).trim() };
  return { scope: "all", text: raw.trim() };
}
