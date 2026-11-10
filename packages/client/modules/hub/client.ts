import type { HubDevice } from "@ai-projector/core/modules/hub/index.ts";

export async function hubRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Ошибка Hub (${response.status})`);
  return data as T;
}

/** Devices of the Hub this page is served by; the device page shares its browser session. */
export async function fetchHubDevices(): Promise<HubDevice[]> {
  return (await hubRequest<{ devices: HubDevice[] }>("/api/hub/devices")).devices;
}
export async function logoutHub(): Promise<void> {
  await hubRequest("/api/hub/session", { method: "DELETE" });
  location.assign("/login");
}
