import type {
  DevcontainerDecision,
  DevcontainerState,
} from "../../../core/modules/devcontainer/index.ts";

async function request(projectId: string, method: string, body?: unknown) {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/devcontainer`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Ошибка Dev Container");
  return data as DevcontainerState;
}
export const fetchDevcontainer = (projectId: string) => request(projectId, "GET");
/** `hash` must be the one shown to the user; the server refuses a config that changed since. */
export const decideDevcontainer = (
  projectId: string,
  decision: DevcontainerDecision | "forget",
  hash?: string,
) => request(projectId, "POST", { decision, hash });
