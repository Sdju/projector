import { useProjects } from "../../project/index.ts";

/** The controls the server publishes for an agent; the role editor only renders them. */
export interface RoleControlOption {
  value: string;
  name: string;
  description?: string;
  group?: string;
}

export interface RoleControl {
  id: string;
  category: "model" | "effort" | "mode" | "flag" | "other";
  name: string;
  description?: string;
  current: string;
  options: RoleControlOption[];
}

/** Reads the same endpoint as a chat; importing the chat module would make a module cycle. */
export async function readControls(agent: string, projectId: string): Promise<RoleControl[]> {
  const response = await fetch(
    `/api/agent/controls?backend=${encodeURIComponent(agent)}&projectId=${encodeURIComponent(projectId)}`,
    { cache: "no-store" },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error((data as { error?: string }).error || "Не удалось получить настройки агента");
  return Array.isArray(data.controls) ? (data.controls as RoleControl[]) : [];
}

let projectLoad: Promise<string> | undefined;

/** Controls need a project folder for external agents; the first project is enough for a preset. */
export function firstProjectId(): Promise<string> {
  projectLoad ??= (async () => {
    const projects = useProjects();
    if (!projects.projects.value.length) await projects.load();
    return projects.projects.value[0]?.id ?? "";
  })().catch(() => "");
  return projectLoad;
}
