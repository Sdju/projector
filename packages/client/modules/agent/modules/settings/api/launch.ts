import type {
  AgentLaunchOverride,
  AgentLaunchSettingsView,
} from "@ai-projector/core/modules/agent-launch/index.ts";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Не удалось получить настройки запуска");
  return data as T;
}

/** Machine-local launch overrides of every registered ACP backend. */
export const readAgentLaunch = () => call<AgentLaunchSettingsView>("/api/agent/launch");

/** Replaces one agent's override; empty fields return it to the descriptor. */
export const writeAgentLaunch = (id: string, value: AgentLaunchOverride) =>
  call<AgentLaunchSettingsView>(`/api/agent/launch/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(value),
  });

/** Removes one agent's override. */
export const resetAgentLaunch = (id: string) =>
  call<AgentLaunchSettingsView>(`/api/agent/launch/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
