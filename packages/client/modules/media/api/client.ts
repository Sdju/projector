import type {
  MediaCapability,
  MediaJob,
  MediaModel,
  MediaRequest,
  MediaState,
} from "@ai-projector/core/modules/media/index.ts";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Ошибка медиа-запроса");
  return data;
}

export function fetchMediaState(): Promise<MediaState> {
  return request("/api/media");
}

export async function fetchMediaModels(capability?: MediaCapability): Promise<MediaModel[]> {
  const query = capability ? `?capability=${encodeURIComponent(capability)}` : "";
  const { models } = await request<{ models: MediaModel[] }>(`/api/media/models${query}`);
  return models;
}

export function generateMedia(body: MediaRequest): Promise<MediaJob> {
  return request("/api/media/generate", { method: "POST", body: JSON.stringify(body) });
}

export function fetchMediaJob(id: string): Promise<MediaJob> {
  return request(`/api/media/jobs/${encodeURIComponent(id)}`);
}

export function cancelMediaJob(id: string): Promise<MediaJob> {
  return request(`/api/media/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}

/** URL скачанного артефакта; upstream-ссылка живёт только 24 часа. */
export function mediaFileUrl(fileId: string): string {
  return `/api/media/files/${encodeURIComponent(fileId)}`;
}
