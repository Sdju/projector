import { getJson } from "./client.ts";
import type { AgentBackendId } from "../model/types.ts";

/** Renames a past session or pins it to the top of the list. */
export async function updateSession(
  backend: AgentBackendId,
  projectId: string,
  sessionId: string,
  change: { title?: string; pinned?: boolean },
): Promise<void> {
  await getJson(
    "/api/agent/sessions/update",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backend, projectId, sessionId, ...change }),
    },
    "Не удалось изменить сессию",
  );
}

/** Removes a past session of the agent for good. */
export async function deleteSession(
  backend: AgentBackendId,
  projectId: string,
  sessionId: string,
): Promise<void> {
  await getJson(
    "/api/agent/sessions/delete",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backend, projectId, sessionId }),
    },
    "Не удалось удалить сессию",
  );
}

/** Adds a message to the answer being written; `false` when that answer has just ended. */
export async function injectAgentMessage(
  messageId: string,
  text: string,
  inputId?: string,
): Promise<boolean> {
  const response = await fetch("/api/agent/inject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messageId, text, inputId }),
  });
  return response.ok;
}
