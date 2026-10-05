import { parseProjectRef } from "../../../../core/modules/project/index.ts";
import type { Project, ProjectDraft, ProjectCommand, ProjectLocation } from "../model/types.ts";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Ошибка запроса");
  return data;
}

export function fetchProjects(): Promise<{ projects: Project[] }> {
  return request("/api/projects");
}

export function resolveProject(path: string): Promise<{ project: Project; missing?: boolean }> {
  return request("/api/projects/resolve", { method: "POST", body: JSON.stringify({ path }) });
}

/** Recreates the folder (`create`) or moves the project to `path` (`relocate`, optionally creating it). */
export function restoreProjectDirectory(
  id: string,
  body: { mode: "create" } | { mode: "relocate"; path: string; create?: boolean },
): Promise<{ project: Project }> {
  return request(`/api/projects/${id}/directory`, { method: "POST", body: JSON.stringify(body) });
}

export function fetchProject(id: string): Promise<{ project: Project }> {
  return request(`/api/projects/${id}`);
}

export function createProject(draft: ProjectDraft): Promise<{ project: Project }> {
  return request("/api/projects", { method: "POST", body: JSON.stringify(draft) });
}

export function updateProject(
  id: string,
  draft: Partial<ProjectDraft>,
): Promise<{ project: Project }> {
  return request(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(draft) });
}

export function deleteProject(id: string): Promise<{ ok: boolean }> {
  return request(`/api/projects/${id}`, { method: "DELETE" });
}

export function inspectPath(path: string): Promise<ProjectDraft> {
  return request("/api/inspect", { method: "POST", body: JSON.stringify({ path }) });
}

export function pickFolder(): Promise<{ path: string | null; cancelled: boolean }> {
  return request("/api/pick-folder", { method: "POST" });
}

export function previewIconUrl(path: string): string {
  return `/api/preview-icon?path=${encodeURIComponent(path)}`;
}

export function projectIconUrl(project: ProjectLocation): string {
  if (project.iconUrl) return project.iconUrl;
  const revision = new URLSearchParams({
    path: project.path,
    name: project.name,
    icon: project.icon ?? "",
  });
  return `/api/projects/${encodeURIComponent(project.id)}/icon?${revision}`;
}

export async function fetchDirectories(
  path: string,
  complete = false,
  signal?: AbortSignal,
): Promise<import("../../../../core/modules/directories/index.ts").DirectoryListing> {
  if (parseProjectRef(path).kind !== "local") return { path, entries: [], truncated: false };
  return request(`/api/directories?${new URLSearchParams({ path, complete: String(complete) })}`, {
    signal,
  });
}

export function inspectCommands(path: string): Promise<{ commands: ProjectCommand[] }> {
  return request("/api/inspect/commands", { method: "POST", body: JSON.stringify({ path }) });
}

export function fetchPathSuggestions(path: string, complete: boolean, signal?: AbortSignal) {
  if (parseProjectRef(path).kind === "local") return fetchDirectories(path, complete, signal);
  return request<import("../../../../core/modules/directories/index.ts").DirectoryListing>(
    `/api/integrations/github/browse/directories?${new URLSearchParams({ path, complete: String(complete) })}`,
    { signal },
  );
}
