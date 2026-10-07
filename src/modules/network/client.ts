import type { NetworkMode } from "../../../core/modules/network-mode/index.ts";

export interface NetworkState {
  mode: NetworkMode;
  passwordRequired: boolean;
  lanUrl: string | null;
  lanUrls: string[];
}

export async function readNetworkState(signal?: AbortSignal): Promise<NetworkState> {
  const response = await fetch("/api/app/network", { cache: "no-store", signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Не удалось загрузить доступ по сети");
  return data;
}

export async function saveNetworkState(
  mode: NetworkMode,
  password: string | undefined,
  signal?: AbortSignal,
): Promise<{ ok: boolean; restarted: boolean }> {
  const response = await fetch("/api/app/network", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, password }),
    signal,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Не удалось сохранить доступ по сети");
  return data;
}

export async function networkServerPid(signal: AbortSignal): Promise<number | null> {
  try {
    const response = await fetch("/api/health", {
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]),
    });
    const data = await response.json();
    return response.ok && Number.isInteger(data.pid) ? data.pid : null;
  } catch {
    signal.throwIfAborted();
    return null;
  }
}

export async function waitForNetworkRestart(pid: number, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const current = await networkServerPid(signal);
    if (current !== null && current !== pid) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Сервер не перезапустился за 60 секунд");
}
