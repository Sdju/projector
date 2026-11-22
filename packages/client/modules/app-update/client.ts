import type { AppUpdateSnapshot } from "./types.ts";

async function parse(response: Response): Promise<AppUpdateSnapshot> {
  const data = (await response.json().catch(() => ({}))) as AppUpdateSnapshot & { error?: string };
  if (!response.ok) throw new Error(data.error || "Не удалось проверить обновление");
  return data;
}

export async function readAppUpdate(signal?: AbortSignal): Promise<AppUpdateSnapshot> {
  const response = await fetch("/api/app/update", {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  return parse(response);
}

export async function checkAppUpdate(signal?: AbortSignal): Promise<AppUpdateSnapshot> {
  const response = await fetch("/api/app/update", {
    method: "POST",
    cache: "no-store",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "check" }),
    signal,
  });
  return parse(response);
}

export async function dismissAppUpdate(
  version?: string,
  signal?: AbortSignal,
): Promise<AppUpdateSnapshot> {
  const response = await fetch("/api/app/update", {
    method: "POST",
    cache: "no-store",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "dismiss", version }),
    signal,
  });
  return parse(response);
}
