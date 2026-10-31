import { currentSession, historyDatabase, loadHistory } from "./history-store.ts";

/** A chat of the project, open in a tab or closed but still on disk. */
export interface RecentChat {
  chat: string;
  backend: string;
  title: string;
  updatedAt: string;
  /** Native session of the agent the chat continues, when it is known: the same talk is listed once. */
  session?: string;
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
    return {
      chat: row.chat,
      backend: row.backend,
      title: row.title,
      updatedAt: row.updated,
      ...(session ? { session } : {}),
    };
  });
}
