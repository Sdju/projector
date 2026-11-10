import { HttpError } from "../http/index.ts";
import { integrationConfig } from "../integration-store/index.ts";
import { normalizeGitlabInstance } from "@ai-projector/core/modules/gitlab/index.ts";
import { gitlab, gitlabAccessToken, gitlabBaseUrl, gitlabCredentialsTokenType } from "./api.ts";

interface ApiProject {
  path_with_namespace: string;
  description: string | null;
  visibility: string;
  web_url: string;
}
const mapProject = (project: ApiProject) => ({
  fullName: project.path_with_namespace,
  description: project.description ?? "",
  private: project.visibility !== "public",
  url: project.web_url,
});

export interface GitlabSearchHit {
  fullName: string;
  description: string;
  private: boolean;
  url: string;
  instance: string;
}
/**
 * Launcher search. The account's own projects (first 100 by activity) are matched locally by full
 * path, so `group/`, `group/part` and short words work; GitLab's own search needs 3+ characters
 * and no namespace, so it only adds other (public) projects for the last path segment.
 */
export async function searchGitlabProjects(query: string): Promise<GitlabSearchHit[]> {
  const config = await integrationConfig("gitlab");
  const base = gitlabBaseUrl(config.settings.url);
  const instance = normalizeGitlabInstance(new URL(base).origin);
  const tokenType = gitlabCredentialsTokenType(config.credentials);
  const token = config.enabled ? await gitlabAccessToken(base, config.credentials) : "";
  const rawNeedle = query.trim().replace(/^\/+/, "");
  const needle = rawNeedle.toLowerCase();
  if (!needle && !token) throw new HttpError(401, "Подключите GitLab в настройках интеграции");
  const found = new Map<string, ApiProject>();
  // An exact `group/project` or a pasted link is a direct project lookup. GitLab's search
  // endpoint only accepts a bare term, so it cannot find a big public project by full path.
  if (rawNeedle.split("/").filter(Boolean).length >= 2 && !rawNeedle.endsWith("/")) {
    try {
      const exact = await gitlab<ApiProject>(
        base,
        `/projects/${encodeURIComponent(rawNeedle)}`,
        token,
        { tokenType },
      );
      if (exact?.path_with_namespace) found.set(exact.path_with_namespace, exact);
    } catch (error) {
      if (!(error instanceof HttpError) || ![401, 403, 404].includes(error.status)) throw error;
    }
  }
  // A group path (`group/`, `group/sub`) lists its projects instead of relying on the
  // term-based project search, which only sees the first page of public matches.
  const groupNeedle = rawNeedle.replace(/\/+$/, "");
  if (found.size < 10 && groupNeedle) {
    try {
      const group = await gitlab<{ id?: number }>(
        base,
        `/groups/${encodeURIComponent(groupNeedle)}`,
        token,
        { tokenType },
      );
      if (group?.id) {
        const projects = await gitlab<ApiProject[]>(
          base,
          `/groups/${group.id}/projects?simple=true&per_page=10&order_by=last_activity_at`,
          token,
          { tokenType },
        );
        for (const project of projects) found.set(project.path_with_namespace, project);
      }
    } catch (error) {
      if (!(error instanceof HttpError) || ![401, 403, 404].includes(error.status)) throw error;
    }
  }
  if (token) {
    const own = await gitlab<ApiProject[]>(
      base,
      "/projects?membership=true&simple=true&order_by=last_activity_at&per_page=100",
      token,
      { tokenType },
    );
    for (const project of own)
      if (project.path_with_namespace.toLowerCase().includes(needle))
        found.set(project.path_with_namespace, project);
  }
  const name = needle
    .split("/")
    .pop()!
    .replace(/[^\w.-]/g, "");
  if (found.size < 10 && name.length >= 3) {
    const params = new URLSearchParams({ simple: "true", per_page: "10", search: name });
    const others = await gitlab<ApiProject[]>(base, `/projects?${params}`, token, { tokenType });
    for (const project of others)
      if (project.path_with_namespace.toLowerCase().includes(needle))
        found.set(project.path_with_namespace, project);
  }
  return [...found.values()].slice(0, 10).map((project) => ({ ...mapProject(project), instance }));
}
