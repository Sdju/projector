export interface AgentSkill {
  name: string;
  description: string;
  hint?: string;
  source: "user" | "project";
  kind: "skill" | "command";
}

export interface AgentSkills {
  skills: AgentSkill[];
  folders: { source: "user" | "project"; path: string }[];
}

export async function readAgentSkills(projectId = ""): Promise<AgentSkills> {
  const response = await fetch(`/api/agent/skills?projectId=${encodeURIComponent(projectId)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Не удалось получить навыки агента");
  return data as AgentSkills;
}
