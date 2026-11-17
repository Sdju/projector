import type { HubDevice } from "@ai-projector/core/modules/hub/index.ts";

export async function hubRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Ошибка Hub (${response.status})`);
  return data as T;
}

/**
 * Devices and their last activity. Hub answers for pages it serves; a local Projector answers
 * from its connector snapshot, adding the saved connection state and problem.
 */
export interface HubPresence {
  devices: HubDevice[];
  activity: Record<string, number>;
  local?: boolean;
  relay?: boolean;
  enabled?: boolean;
  online?: boolean;
  url?: string;
  deviceId?: string;
  error?: string;
}

const isDevice = (value: unknown): value is HubDevice => {
  if (!value || typeof value !== "object") return false;
  const device = value as Record<string, unknown>;
  return (
    typeof device.id === "string" &&
    typeof device.name === "string" &&
    typeof device.protocol === "number" &&
    typeof device.online === "boolean"
  );
};

/** A malformed answer must not become a device list with broken links. */
export function normalizeHubPresence(value: unknown): HubPresence {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const activity: Record<string, number> = {};
  if (raw.activity && typeof raw.activity === "object" && !Array.isArray(raw.activity))
    for (const [id, at] of Object.entries(raw.activity))
      if (typeof at === "number" && Number.isFinite(at)) activity[id] = at;
  return {
    devices: Array.isArray(raw.devices) ? raw.devices.filter(isDevice) : [],
    activity,
    ...(raw.local === true ? { local: true, relay: raw.relay === true } : {}),
    ...(typeof raw.enabled === "boolean" ? { enabled: raw.enabled } : {}),
    ...(typeof raw.online === "boolean" ? { online: raw.online } : {}),
    ...(typeof raw.url === "string" ? { url: raw.url } : {}),
    ...(typeof raw.deviceId === "string" ? { deviceId: raw.deviceId } : {}),
    ...(typeof raw.error === "string" ? { error: raw.error } : {}),
  };
}

/** Devices of the Hub this page is served by; the device page shares its browser session. */
export async function fetchHubPresence(): Promise<HubPresence> {
  return normalizeHubPresence(
    await hubRequest("/api/hub/devices", { signal: AbortSignal.timeout(10_000) }),
  );
}

export async function fetchHubDevices(): Promise<HubDevice[]> {
  return (await fetchHubPresence()).devices;
}

export async function logoutHub(): Promise<void> {
  await hubRequest("/api/hub/session", { method: "DELETE" });
  location.assign("/login");
}
