export async function dockerRequest<T>(
  path = "",
  projectId?: string,
  method = "GET",
  body?: unknown,
  query: Record<string, string> = {},
): Promise<T> {
  const params = new URLSearchParams(query);
  if (projectId) params.set("projectId", projectId);
  const response = await fetch(`/api/docker${path}?${params}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Ошибка Docker");
  return data;
}
