import { deviceUrl } from "../../common/utilities/device-url.ts";
import type { PluginCatalog, PluginInfo } from "../plugins/index.ts";

async function request(projectId: string, init?: RequestInit): Promise<PluginCatalog> {
  const response = await fetch(
    deviceUrl(`/api/plugins?projectId=${encodeURIComponent(projectId)}`),
    {
      ...init,
      headers: { "Content-Type": "application/json" },
    },
  );
  const data = (await response.json()) as PluginCatalog & { error?: string };
  if (!response.ok) throw new Error(data.error || "Не удалось прочитать плагины проекта");
  return data;
}

function projectEntries(catalog: PluginCatalog, projectId: string): PluginInfo[] {
  return catalog.plugins.filter((plugin) => plugin.projectId === projectId);
}

export async function fetchProjectPlugins(projectId: string): Promise<PluginInfo[]> {
  return projectEntries(await request(projectId), projectId);
}

export type ProjectPluginAction = "refresh" | "trust" | "untrust" | "enable" | "disable";

export async function projectPluginAction(
  projectId: string,
  action: ProjectPluginAction,
  id?: string,
): Promise<PluginInfo[]> {
  const catalog = await request(projectId, {
    method: "POST",
    body: JSON.stringify({ projectId, action, ...(id ? { id } : {}) }),
  });
  return projectEntries(catalog, projectId);
}
