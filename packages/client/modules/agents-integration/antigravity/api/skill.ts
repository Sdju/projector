import type { AntigravitySkillState } from "@ai-projector/core/modules/agents-integration/antigravity/index.ts";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { Accept: "application/json" },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Не удалось обновить навык Antigravity");
  return data as T;
}

export const readAntigravitySkill = () => call<AntigravitySkillState>("/api/antigravity/skill");

export const installAntigravitySkill = () =>
  call<AntigravitySkillState>("/api/antigravity/skill", { method: "PUT" });

export const removeAntigravitySkill = () =>
  call<AntigravitySkillState>("/api/antigravity/skill", { method: "DELETE" });
