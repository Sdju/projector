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

export function searchWorkspace(
  projectId: string,
  query: string,
  options: import("../../../core/modules/workspace/index.ts").SearchOptions,
  signal?: AbortSignal,
) {
  return workspaceRequest<
    { hits: import("../../../core/modules/workspace/index.ts").SearchHit[]; truncated: boolean }
  >(
    projectId,
    "search",
    {
      q: query,
      case: String(!!options.caseSensitive),
      word: String(!!options.wholeWord),
      regex: String(!!options.regex),
    },
    signal,
  );
}

export function gutterRequest(projectId: string, path: string, signal?: AbortSignal) {
  return workspaceRequest<import("../../../core/modules/workspace/index.ts").GitGutter>(
    projectId,
    "gutter",
    { path },
    signal,
  );
}

export async function saveWorkspaceFile(
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

export async function mutateWorkspaceEntry(
  projectId: string,
  action: string,
  path = "",
  directory = "",
  name = "",
) {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/workspace/entry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, path, directory, name }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Не удалось выполнить действие");
  return data as { source?: string; destination?: string };
}

export async function mutateWorkspaceGit(
  projectId: string,
  action: string,
  path: string | string[],
) {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/workspace/git`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...(Array.isArray(path) ? { paths: path } : { path }) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Не удалось выполнить действие Git");
  return data as import("../../../core/modules/workspace/index.ts").GitOverview;
}
