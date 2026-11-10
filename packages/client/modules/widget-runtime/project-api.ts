import type {
  ProjectWidgetData,
  ProjectWidgetState,
} from "@ai-projector/core/modules/widget-catalog/index.ts";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Виджеты проекта недоступны");
  return data as T;
}

export function readProjectWidgets(projectId: string): Promise<ProjectWidgetState> {
  return call<ProjectWidgetState>(
    `/api/agent/project-widgets?projectId=${encodeURIComponent(projectId)}`,
  );
}

export function writeProjectWidgetTrust(
  projectId: string,
  trusted: boolean,
): Promise<ProjectWidgetState> {
  return call<ProjectWidgetState>("/api/agent/project-widgets/trust", {
    method: "PUT",
    body: JSON.stringify({ projectId, trusted }),
  });
}

export function readProjectWidgetData(
  projectId: string,
  widget: string,
): Promise<ProjectWidgetData> {
  return call<ProjectWidgetData>(
    `/api/agent/project-widgets/data?projectId=${encodeURIComponent(projectId)}&widget=${encodeURIComponent(widget)}`,
  );
}
