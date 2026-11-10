import { currentSession, deleteHistory, historyDatabase, loadHistory } from "./history-store.ts";
import { readChatRole } from "./role-store.ts";
import type { AgentRoleSnapshot } from "@projector-ai/core/modules/agent-role/index.ts";

/** A chat of the project, open in a tab or closed but still on disk. */
export interface RecentChat {
  chat: string;
  backend: string;
  title: string;
  updatedAt: string;
  /** Native session of the agent the chat continues, when it is known: the same talk is listed once. */
  session?: string;
  /** The role the chat started with; kept even when the role is later edited or deleted. */
  role?: AgentRoleSnapshot;
}

/** The native session saved with a chat, for rows created before the index stored it. */
function sessionFromHistory(chat: string): string | undefined {
  const turns = loadHistory(chat);
  return turns ? currentSession(turns) : undefined;
}

/** Chats of a project, newest first: open in a tab or closed with their history still on disk. */
export function readRecentChats(project: string, backend?: string, limit = 50): RecentChat[] {
  if (!project) return [];
  const db = historyDatabase();
  // The project's own conversation (key = project) has no tab command to reopen it; it is opened
  // by the workspace itself and is left out of the list.
  const rows = (backend
    ? db
        .prepare(
          "SELECT chat, backend, title, updated, session FROM chat_index WHERE scope = ? AND chat <> scope AND backend = ? ORDER BY updated DESC LIMIT ?",
        )
        .all(project, backend, limit)
    : db
        .prepare(
          "SELECT chat, backend, title, updated, session FROM chat_index WHERE scope = ? AND chat <> scope ORDER BY updated DESC LIMIT ?",
        )
        .all(project, limit)) as unknown as {
    chat: string;
    backend: string;
    title: string;
    updated: string;
    session: string | null;
  }[];
  const remember = db.prepare("UPDATE chat_index SET session = ? WHERE chat = ?");
  return rows.map((row) => {
    // Rows written before the index knew sessions get theirs from the saved turns, once.
    const session = row.session ?? sessionFromHistory(row.chat);
    if (!row.session && session) remember.run(session, row.chat);
    const role = readChatRole(row.chat);
    return {
      chat: row.chat,
      backend: row.backend,
      title: row.title,
      updatedAt: row.updated,
      ...(session ? { session } : {}),
      ...(role ? { role } : {}),
    };
  });
}

/**
 * Forgets the chats that continued a native session which was just deleted: otherwise each of
 * them would come back as a separate, undeletable copy of the removed conversation.
 * `keep` is the chat asking for the deletion: its own tab stays as it is.
 */
export function removeChatsWithSession(
  project: string,
  backend: string,
  session: string,
  keep = "",
): string[] {
  if (!project) return [];
  const rows = historyDatabase()
    .prepare(
      "SELECT chat FROM chat_index WHERE scope = ? AND backend = ? AND session = ? AND chat <> ?",
    )
    .all(project, backend, session, keep) as unknown as { chat: string }[];
  for (const row of rows) deleteHistory(row.chat);
  return rows.map((row) => row.chat);
}

/** Removes a chat of this project with its saved turns; a tab that is open keeps its screen. */
export function forgetChat(project: string, chat: string): boolean {
  if (!project || !chat) return false;
  const row = historyDatabase().prepare("SELECT scope FROM chat_index WHERE chat = ?").get(chat) as
    | { scope: string }
    | undefined;
  if (!row || row.scope !== project) return false;
  deleteHistory(chat);
  return true;
}
