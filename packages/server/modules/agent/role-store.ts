import {
  normalizeRoleSnapshot,
  type AgentRoleSnapshot,
} from "@ai-projector/core/modules/agent-role/index.ts";
import { historyDatabase } from "./history-store.ts";

/** The role a chat was started with; absent means it has no role of its own. */
export function readChatRole(chat: string): AgentRoleSnapshot | undefined {
  const row = historyDatabase().prepare("SELECT role FROM chats WHERE id = ?").get(chat) as
    | { role: string | null }
    | undefined;
  if (!row?.role) return undefined;
  try {
    return normalizeRoleSnapshot(JSON.parse(row.role));
  } catch {
    return undefined;
  }
}

/** Replaces the chat's role snapshot; `null` removes it. */
export function saveChatRole(chat: string, role: AgentRoleSnapshot | null): void {
  historyDatabase()
    .prepare(
      `INSERT INTO chats (id, role) VALUES (?, ?)
       ON CONFLICT (id) DO UPDATE SET role = excluded.role`,
    )
    .run(chat, role ? JSON.stringify(role) : null);
}
