import type { AgentSessionInfo, AgentTurn } from "../model/types.ts";

async function post<T>(path: string, body: object, failure: string): Promise<T> {
  const response = await fetch(`/api/agent/chats/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || failure);
  return data as T;
}

/** Past chats of the Projector agent in this chat's scope, pinned first, then newest. */
export async function fetchChats(key: string): Promise<AgentSessionInfo[]> {
  const response = await fetch(`/api/agent/chats?key=${encodeURIComponent(key)}`);
  const data = (await response.json().catch(() => ({}))) as {
    chats?: AgentSessionInfo[];
    error?: string;
  };
  if (!response.ok) throw new Error(data.error || "Не удалось получить историю чатов");
  return data.chats ?? [];
}

/** Puts the live chat aside and empties it. */
export const archiveChat = (key: string) =>
  post<{ id: string | null }>("archive", { key }, "Не удалось сохранить чат в истории");

/** Brings a past chat back as the live one; the live one goes to the history. */
export const openChat = (key: string, id: string) =>
  post<{ turns: AgentTurn[] }>("open", { key, id }, "Не удалось открыть чат");

export const updateChat = (id: string, change: { title?: string; pinned?: boolean }) =>
  post("update", { id, ...change }, "Не удалось изменить чат");

export const deleteChat = (id: string) => post("delete", { id }, "Не удалось удалить чат");
