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

export async function saveWorkspaceMarkdown(
  projectId: string,
  path: string,
  content: string,
  original: string,
) {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/workspace/file`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content, original }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Не удалось сохранить файл");
  return data as { path: string; content: string };
}

export async function moveWorkspaceEntry(projectId: string, path: string, directory: string) {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/workspace/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, directory }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Не удалось перенести запись");
  return data as { source: string; destination: string };
}
