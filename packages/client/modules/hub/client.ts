export async function hubRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Ошибка Hub (${response.status})`);
  return data as T;
}
export async function logoutHub(): Promise<void> {
  await hubRequest("/api/hub/session", { method: "DELETE" });
  location.assign("/login");
}
