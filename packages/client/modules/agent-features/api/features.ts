export interface AgentFeatureAgent {
  id: string;
  label: string;
  enabled: boolean;
}

export interface AgentFeatureItem {
  id: string;
  title: string;
  summary: string;
  agents: AgentFeatureAgent[];
}

export interface AgentFeatures {
  features: AgentFeatureItem[];
  /** Where the choices are stored, for the hint under the list. */
  file: string;
}

async function read(response: Response): Promise<AgentFeatures> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Не удалось получить возможности агентов");
  return data as AgentFeatures;
}

export async function readAgentFeatures(): Promise<AgentFeatures> {
  return read(await fetch("/api/agent/features"));
}

export async function writeAgentFeature(
  feature: string,
  agent: string,
  enabled: boolean,
): Promise<AgentFeatures> {
  return read(
    await fetch("/api/agent/features", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feature, agent, enabled }),
    }),
  );
}
