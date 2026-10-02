import type { LaunchMode, ProcessSnapshot } from "../../catalog/index.ts";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Ошибка запроса");
  return data;
}

export function startProject(
  id: string,
  commandId?: string,
  mode?: LaunchMode,
): Promise<{ runtime: ProcessSnapshot }> {
  return request(`/api/projects/${id}/start`, {
    method: "POST",
    body: JSON.stringify({ commandId, mode }),
  });
}

export function stopProject(id: string): Promise<{ runtime: ProcessSnapshot }> {
  return request(`/api/projects/${id}/stop`, { method: "POST" });
}

export function openProject(id: string, mode: LaunchMode): Promise<{ url: string }> {
  return request(`/api/projects/${id}/open`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}
