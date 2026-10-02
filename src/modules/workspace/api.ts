export async function workspaceRequest<T>(
  projectId: string,
  action: string,
  params: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/workspace/${action}?${new URLSearchParams(params)}`,
    { signal },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Не удалось прочитать проект");
  return data as T;
}
