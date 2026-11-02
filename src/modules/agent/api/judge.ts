import type { JudgeSettings } from "../../../../core/modules/agent-judge/index.ts";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Судья недоступен");
  return data as T;
}

export function readJudgeSettings(): Promise<JudgeSettings> {
  return call<JudgeSettings>("/api/agent/judge");
}

export function writeJudgeSettings(value: JudgeSettings): Promise<JudgeSettings> {
  return call<JudgeSettings>("/api/agent/judge", {
    method: "PUT",
    body: JSON.stringify(value),
  });
}
