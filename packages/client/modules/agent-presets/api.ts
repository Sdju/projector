import type {
  AgentPresetBundle,
  AgentPresetDraft,
} from "@ai-projector/core/modules/agent-preset/index.ts";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Пресеты агента недоступны");
  return data as T;
}

/** Global presets and, when a project is named, its presets file and trust decision. */
export function readAgentPresets(projectId?: string): Promise<AgentPresetBundle> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return call<AgentPresetBundle>(`/api/agent/presets${query}`);
}

export function createAgentPreset(
  preset: Partial<AgentPresetDraft>,
  projectId?: string,
): Promise<AgentPresetBundle> {
  return call<AgentPresetBundle>("/api/agent/presets", {
    method: "POST",
    body: JSON.stringify({ preset, ...(projectId ? { projectId } : {}) }),
  });
}

export function writeAgentPreset(
  id: string,
  preset: Partial<AgentPresetDraft>,
  projectId?: string,
): Promise<AgentPresetBundle> {
  return call<AgentPresetBundle>(`/api/agent/presets/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ preset, ...(projectId ? { projectId } : {}) }),
  });
}

export function removeAgentPreset(id: string, projectId?: string): Promise<AgentPresetBundle> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return call<AgentPresetBundle>(`/api/agent/presets/${encodeURIComponent(id)}${query}`, {
    method: "DELETE",
  });
}

export function setAgentPresetTrust(
  projectId: string,
  trusted: boolean,
): Promise<AgentPresetBundle> {
  return call<AgentPresetBundle>("/api/agent/presets/trust", {
    method: "PUT",
    body: JSON.stringify({ projectId, trusted }),
  });
}
