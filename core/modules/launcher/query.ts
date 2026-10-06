/**
 * Префикс запроса сужает область поиска: `/` — проекты, `gh/` — репозитории GitHub, `gl/` — проекты GitLab.
 * Ссылка `https://github.com/owner/repo` равна `gh/owner/repo`; ссылка на любой хост со словом gitlab в имени равна `gl/путь`.
 */
export type LaunchScope = "all" | "projects" | "github" | "gitlab";
export interface ParsedQuery {
  scope: LaunchScope;
  text: string;
}
export const launchScopeTitles: Record<Exclude<LaunchScope, "all">, string> = {
  projects: "Проекты",
  github: "GitHub",
  gitlab: "GitLab",
};

/** Any host with "gitlab" in its name: gitlab.com and self-hosted (gitlab.example.com, git.gitlab-x.org). */
const GITLAB_URL = /^https?:\/\/[^/\s]*gitlab[^/\s]*(?::\d+)?(?:\/|$)/i;

const GITHUB_URL = /^https?:\/\/(?:www\.)?github\.com(?:\/|$)/i;

/** `owner/repo/tree/main?x#y` → `owner/repo`; one segment → `owner/` (list that owner). */
function githubUrlText(rest: string): string {
  const [owner = "", repo = ""] = rest.split(/[?#]/)[0].split("/").filter(Boolean);
  if (!owner) return "";
  return repo ? `${owner}/${repo.replace(/\.git$/i, "")}` : `${owner}/`;
}

/** `group/sub/project/-/tree/main?x` → `group/sub/project`; one segment → `group/`. */
function gitlabUrlText(rest: string): string {
  const segments = rest.split(/[?#]/)[0].split("/-/")[0].split("/").filter(Boolean);
  if (!segments.length) return "";
  const path = segments.join("/").replace(/\.git$/i, "");
  return segments.length > 1 ? path : `${path}/`;
}

export function parseLaunchQuery(raw: string): ParsedQuery {
  const query = raw.trimStart();
  const url = GITHUB_URL.exec(query);
  if (url) return { scope: "github", text: githubUrlText(query.slice(url[0].length)) };
  const gitlabUrl = GITLAB_URL.exec(query);
  if (gitlabUrl) return { scope: "gitlab", text: gitlabUrlText(query.slice(gitlabUrl[0].length)) };
  if (/^gh\//i.test(query)) return { scope: "github", text: query.slice(3).trim() };
  if (/^gl\//i.test(query)) return { scope: "gitlab", text: query.slice(3).trim() };
  if (query.startsWith("/")) return { scope: "projects", text: query.slice(1).trim() };
  return { scope: "all", text: raw.trim() };
}
